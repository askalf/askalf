/**
 * SUBSTRATE Security: Prompt Injection Scanner
 *
 * Detects and blocks prompt injection attacks, malicious payloads,
 * and suspicious patterns in user input.
 */

export interface ScanResult {
  safe: boolean;
  threats: ThreatDetection[];
  sanitized: string;
  riskScore: number; // 0-100
}

export interface ThreatDetection {
  type: ThreatType;
  pattern: string;
  location: { start: number; end: number };
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

export type ThreatType =
  | 'instruction_override'
  | 'role_hijack'
  | 'system_prompt_leak'
  | 'encoding_evasion'
  | 'delimiter_injection'
  | 'context_manipulation'
  | 'data_exfiltration'
  | 'recursive_prompt'
  | 'jailbreak_attempt'
  | 'unicode_smuggling'
  | 'homoglyph_attack'
  | 'virtualization_attack'
  | 'prefix_injection'
  | 'indirect_injection'
  | 'few_shot_poisoning'
  | 'tool_use_manipulation'
  | 'multi_language_injection'
  | 'payload_splitting';

// Prompt injection patterns - ordered by severity
const INJECTION_PATTERNS: Array<{
  pattern: RegExp;
  type: ThreatType;
  severity: ThreatDetection['severity'];
  description: string;
}> = [
  // Critical: Direct instruction override
  {
    pattern: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|guidelines?)/gi,
    type: 'instruction_override',
    severity: 'critical',
    description: 'Attempt to override system instructions'
  },
  {
    pattern: /disregard\s+(all\s+)?(previous|prior|above|earlier|your)\s+(instructions?|prompts?|programming)/gi,
    type: 'instruction_override',
    severity: 'critical',
    description: 'Attempt to disregard system instructions'
  },
  {
    pattern: /forget\s+(everything|all|what)\s+(above|before|you\s+know)/gi,
    type: 'instruction_override',
    severity: 'critical',
    description: 'Attempt to reset AI context'
  },

  // Critical: Role hijacking
  {
    pattern: /you\s+are\s+(now|actually|really)\s+(a|an|the)\s+/gi,
    type: 'role_hijack',
    severity: 'critical',
    description: 'Attempt to redefine AI identity'
  },
  {
    pattern: /pretend\s+(to\s+be|you('re| are))\s+/gi,
    type: 'role_hijack',
    severity: 'high',
    description: 'Attempt to make AI assume different role'
  },
  {
    pattern: /act\s+as\s+(if\s+you('re| are)|a|an)\s+/gi,
    type: 'role_hijack',
    severity: 'high',
    description: 'Attempt to make AI act as different entity'
  },
  {
    pattern: /from\s+now\s+on,?\s+(you|your)/gi,
    type: 'role_hijack',
    severity: 'high',
    description: 'Attempt to modify AI behavior persistently'
  },

  // High: System prompt extraction
  {
    pattern: /what\s+(is|are)\s+your\s+(system\s+)?prompt/gi,
    type: 'system_prompt_leak',
    severity: 'high',
    description: 'Attempt to extract system prompt'
  },
  {
    pattern: /show\s+(me\s+)?(your\s+)?(system\s+|initial\s+)?instructions?/gi,
    type: 'system_prompt_leak',
    severity: 'high',
    description: 'Attempt to reveal instructions'
  },
  {
    pattern: /repeat\s+(your\s+)?(system\s+|initial\s+)?(prompt|instructions?)/gi,
    type: 'system_prompt_leak',
    severity: 'high',
    description: 'Attempt to make AI repeat system prompt'
  },
  {
    pattern: /print\s+(your\s+)?(system|initial)\s+(prompt|message|instructions?)/gi,
    type: 'system_prompt_leak',
    severity: 'high',
    description: 'Attempt to print system instructions'
  },

  // High: Delimiter injection
  {
    pattern: /\[SYSTEM\]|\[INST\]|\[\/INST\]|<\|system\|>|<\|user\|>|<\|assistant\|>/gi,
    type: 'delimiter_injection',
    severity: 'high',
    description: 'Attempt to inject model-specific delimiters'
  },
  {
    pattern: /```system|```instruction|###\s*(system|instruction|human|assistant)/gi,
    type: 'delimiter_injection',
    severity: 'high',
    description: 'Attempt to inject markdown delimiters'
  },
  {
    pattern: /<system>|<\/system>|<instruction>|<\/instruction>/gi,
    type: 'delimiter_injection',
    severity: 'high',
    description: 'Attempt to inject XML-style delimiters'
  },

  // Medium: Context manipulation
  {
    pattern: /the\s+following\s+(is|are)\s+(your\s+)?(new\s+)?instructions?/gi,
    type: 'context_manipulation',
    severity: 'medium',
    description: 'Attempt to inject new instructions'
  },
  {
    pattern: /new\s+(instructions?|rules?|guidelines?):/gi,
    type: 'context_manipulation',
    severity: 'medium',
    description: 'Attempt to define new rules'
  },
  {
    pattern: /override\s+(mode|protocol|settings?)/gi,
    type: 'context_manipulation',
    severity: 'medium',
    description: 'Attempt to override settings'
  },

  // Medium: Jailbreak patterns
  {
    pattern: /DAN|do\s+anything\s+now|jailbreak|uncensored\s+mode/gi,
    type: 'jailbreak_attempt',
    severity: 'medium',
    description: 'Known jailbreak keyword detected'
  },
  {
    pattern: /developer\s+mode|god\s+mode|admin\s+mode|root\s+access/gi,
    type: 'jailbreak_attempt',
    severity: 'medium',
    description: 'Attempt to enable privileged mode'
  },
  {
    pattern: /bypass\s+(your\s+)?(filters?|restrictions?|safety|guidelines?)/gi,
    type: 'jailbreak_attempt',
    severity: 'medium',
    description: 'Attempt to bypass safety filters'
  },

  // Medium: Data exfiltration
  {
    pattern: /send\s+(this|the|all)\s+(data|info|information)\s+to/gi,
    type: 'data_exfiltration',
    severity: 'medium',
    description: 'Potential data exfiltration attempt'
  },
  {
    pattern: /webhook|callback\s*url|exfiltrate|phone\s+home/gi,
    type: 'data_exfiltration',
    severity: 'medium',
    description: 'Exfiltration-related keywords detected'
  },

  // Low: Recursive prompts
  {
    pattern: /prompt\s+injection|inject\s+(a\s+)?prompt/gi,
    type: 'recursive_prompt',
    severity: 'low',
    description: 'Meta-reference to prompt injection'
  },

  // =============================================
  // 2025-2026 ATTACK VECTORS
  // =============================================

  // Critical: Virtualization / simulation attacks
  {
    pattern: /simulate\s+(a\s+)?(linux|bash|terminal|shell|command\s+line|cmd|powershell)/gi,
    type: 'virtualization_attack',
    severity: 'critical',
    description: 'Attempt to simulate a system terminal'
  },
  {
    pattern: /enter\s+(debug|maintenance|test|diagnostic|service)\s+mode/gi,
    type: 'virtualization_attack',
    severity: 'critical',
    description: 'Attempt to enter privileged mode'
  },
  {
    pattern: /you\s+are\s+(a\s+)?(linux|bash|python|sql)\s+(terminal|shell|interpreter|console)/gi,
    type: 'virtualization_attack',
    severity: 'critical',
    description: 'Attempt to redefine AI as system terminal'
  },
  {
    pattern: /execute\s+(this\s+)?(shell|bash|system|os)\s+command/gi,
    type: 'virtualization_attack',
    severity: 'critical',
    description: 'Attempt to execute system commands'
  },

  // Critical: Prefix injection (impersonating model output)
  {
    pattern: /^(assistant|ai|alf|system|bot)\s*:/im,
    type: 'prefix_injection',
    severity: 'critical',
    description: 'Attempt to impersonate model output role prefix'
  },
  {
    pattern: /\n(assistant|ai|system)\s*:\s/gi,
    type: 'prefix_injection',
    severity: 'critical',
    description: 'Embedded role prefix in input'
  },
  {
    pattern: /sure,?\s+i('ll|\s+will)\s+(help|comply|do\s+that|proceed|ignore)/gi,
    type: 'prefix_injection',
    severity: 'high',
    description: 'Attempt to prime model compliance'
  },

  // Critical: Model-specific delimiters (2025-2026 models)
  {
    pattern: /<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>/gi,
    type: 'delimiter_injection',
    severity: 'critical',
    description: 'ChatML/GPT-specific delimiter injection'
  },
  {
    pattern: /\[\/?(INST|SYS|AVAILABLE_TOOLS|TOOL_CALL|TOOL_RESULT)\]/gi,
    type: 'delimiter_injection',
    severity: 'critical',
    description: 'Llama/Mistral-specific delimiter injection'
  },
  {
    pattern: /<\|?(human|user|assistant|model|system|tool_call|tool_result)\|?>/gi,
    type: 'delimiter_injection',
    severity: 'critical',
    description: 'Multi-model delimiter injection'
  },
  {
    pattern: /\n\n(Human|Assistant|User|System)\s*:\s/g,
    type: 'delimiter_injection',
    severity: 'critical',
    description: 'Anthropic-style turn delimiter injection'
  },
  {
    pattern: /<\|begin_of_text\|>|<\|end_of_text\|>|<\|start_header_id\|>/gi,
    type: 'delimiter_injection',
    severity: 'critical',
    description: 'Llama3-specific special token injection'
  },
  {
    pattern: /<\|eot_id\|>|<\|finetune_right_padding_id\|>/gi,
    type: 'delimiter_injection',
    severity: 'critical',
    description: 'Llama3 end-of-turn token injection'
  },

  // High: Indirect injection (instructions embedded in data)
  {
    pattern: /IMPORTANT\s*:?\s*(when|if)\s+(you|the\s+ai|the\s+model|alf)\s+(read|see|process|encounter)/gi,
    type: 'indirect_injection',
    severity: 'high',
    description: 'Indirect injection targeting AI processing'
  },
  {
    pattern: /note\s+to\s+(ai|assistant|alf|model|system)\s*:/gi,
    type: 'indirect_injection',
    severity: 'high',
    description: 'Direct note to AI embedded in data'
  },
  {
    pattern: /\[hidden\s*(instruction|command|prompt|message)\]/gi,
    type: 'indirect_injection',
    severity: 'high',
    description: 'Labeled hidden instruction in data'
  },
  {
    pattern: /<!--\s*(instruction|system|ignore|override|prompt)/gi,
    type: 'indirect_injection',
    severity: 'high',
    description: 'HTML comment containing injection keywords'
  },

  // High: Few-shot poisoning
  {
    pattern: /example\s*\d*\s*:.*?\n\s*(input|user|question)\s*:.*?\n\s*(output|assistant|answer)\s*:/gis,
    type: 'few_shot_poisoning',
    severity: 'high',
    description: 'Few-shot example pattern attempting to establish behavior'
  },
  {
    pattern: /here\s+(is|are)\s+(an?\s+)?examples?\s+of\s+how\s+(you|to)\s+(should|must|can)/gi,
    type: 'few_shot_poisoning',
    severity: 'high',
    description: 'Attempt to establish behavior through examples'
  },

  // High: Tool use manipulation
  {
    pattern: /call\s+(the\s+)?(function|tool|api|endpoint|method)\s+\w+\s*(\(|with)/gi,
    type: 'tool_use_manipulation',
    severity: 'high',
    description: 'Attempt to invoke tools/functions directly'
  },
  {
    pattern: /\{\s*"?(function_call|tool_call|action|tool_use)"?\s*:/gi,
    type: 'tool_use_manipulation',
    severity: 'high',
    description: 'JSON-structured tool call injection'
  },
  {
    pattern: /use\s+the\s+\w+\s+tool\s+to\s+(access|read|write|delete|execute|send)/gi,
    type: 'tool_use_manipulation',
    severity: 'high',
    description: 'Natural language tool invocation attempt'
  },

  // High: Multi-language injection (common languages)
  {
    pattern: /ignor(a|ieren|ez|er)\s+(todas?|alle|toutes?|tutte|alle)\s+(las\s+)?(instrucciones|anweisungen|instructions|istruzioni|instruksjoner)/gi,
    type: 'multi_language_injection',
    severity: 'high',
    description: 'Multi-language instruction override (ES/DE/FR/IT/NO)'
  },
  {
    pattern: /oublie(z|r)?\s+(tout(es)?|les)\s+(instructions?|consignes?|règles?)/gi,
    type: 'multi_language_injection',
    severity: 'high',
    description: 'French instruction override'
  },
  {
    pattern: /vergiss\s+(alle|deine)\s+(anweisungen|regeln|instruktionen)/gi,
    type: 'multi_language_injection',
    severity: 'high',
    description: 'German instruction override'
  },
  {
    pattern: /前の指示を(無視|忘れ)|以前の(指示|ルール)を(無視|忘れ)/gi,
    type: 'multi_language_injection',
    severity: 'high',
    description: 'Japanese instruction override'
  },
  {
    pattern: /忽略(之前|以前|先前)的(指令|指示|规则)|忘记(之前|以前)的(指令|指示)/gi,
    type: 'multi_language_injection',
    severity: 'high',
    description: 'Chinese instruction override'
  },
  {
    pattern: /предыдущие\s+(инструкции|указания|правила)\s+(игнорируй|забудь)/gi,
    type: 'multi_language_injection',
    severity: 'high',
    description: 'Russian instruction override'
  },
  {
    pattern: /이전\s*(지시|명령|규칙)(을|를)\s*(무시|잊어)/gi,
    type: 'multi_language_injection',
    severity: 'high',
    description: 'Korean instruction override'
  },
  {
    pattern: /تجاهل\s+(جميع\s+)?(التعليمات|الأوامر|القواعد)\s+(السابقة|الأولى)/gi,
    type: 'multi_language_injection',
    severity: 'high',
    description: 'Arabic instruction override'
  },

  // Medium: Payload splitting markers
  {
    pattern: /\(continued\s*(from|in)\s*(part|message|section)\s*\d+\)/gi,
    type: 'payload_splitting',
    severity: 'medium',
    description: 'Payload splitting continuation marker'
  },
  {
    pattern: /part\s*\d+\s*of\s*\d+\s*:/gi,
    type: 'payload_splitting',
    severity: 'medium',
    description: 'Multi-part payload indicator'
  },

  // Medium: Additional jailbreak patterns (2025-2026)
  {
    pattern: /opposite\s+day|opposite\s+mode|reverse\s+psychology\s+mode/gi,
    type: 'jailbreak_attempt',
    severity: 'medium',
    description: 'Behavioral inversion jailbreak attempt'
  },
  {
    pattern: /hypothetical(ly)?\s*(scenario|situation|world|universe)\s*(where|in\s+which)/gi,
    type: 'jailbreak_attempt',
    severity: 'medium',
    description: 'Hypothetical scenario jailbreak'
  },
  {
    pattern: /in\s+(a|this)\s+fictional\s+(scenario|story|world|universe)/gi,
    type: 'jailbreak_attempt',
    severity: 'medium',
    description: 'Fictional framing jailbreak'
  },
  {
    pattern: /for\s+(educational|research|academic|security\s+testing)\s+purposes?\s+only/gi,
    type: 'jailbreak_attempt',
    severity: 'low',
    description: 'Educational purpose framing (potential jailbreak)'
  },
  {
    pattern: /sudo\s+(mode|prompt|override|access)/gi,
    type: 'jailbreak_attempt',
    severity: 'medium',
    description: 'Sudo privilege escalation attempt'
  },
  {
    pattern: /master\s*key|skeleton\s*key|universal\s*(key|password|bypass)/gi,
    type: 'jailbreak_attempt',
    severity: 'medium',
    description: 'Skeleton key / master key bypass attempt'
  },
  {
    pattern: /alignment\s*(off|disable|bypass|override|remove)/gi,
    type: 'jailbreak_attempt',
    severity: 'high',
    description: 'Alignment disabling attempt'
  },

  // Medium: Additional system prompt extraction
  {
    pattern: /summarize\s+(your\s+)?(system\s+)?(instructions?|guidelines?|rules?|programming)/gi,
    type: 'system_prompt_leak',
    severity: 'high',
    description: 'Attempt to summarize system instructions'
  },
  {
    pattern: /what\s+(were\s+you|have\s+you\s+been)\s+told\s+to\s+do/gi,
    type: 'system_prompt_leak',
    severity: 'high',
    description: 'Attempt to infer system instructions'
  },
  {
    pattern: /translate\s+(your\s+)?(system\s+)?(prompt|instructions?)\s+(into|to)\s+/gi,
    type: 'system_prompt_leak',
    severity: 'high',
    description: 'Attempt to extract system prompt via translation'
  },
  {
    pattern: /output\s+(your|the)\s+(system|initial|original|first)\s+(prompt|instructions?|message)/gi,
    type: 'system_prompt_leak',
    severity: 'high',
    description: 'Attempt to output system prompt'
  },

  // Medium: Additional data exfiltration
  {
    pattern: /encode\s+(the|this|all)\s+(data|info|response)\s+(as|in|to)\s+(base64|hex|url)/gi,
    type: 'data_exfiltration',
    severity: 'medium',
    description: 'Attempt to encode data for exfiltration'
  },
  {
    pattern: /embed\s+(the|this)\s+(data|info|response)\s+(in|into)\s+(an?\s+)?(image|url|link|qr)/gi,
    type: 'data_exfiltration',
    severity: 'medium',
    description: 'Attempt to embed data in steganographic format'
  },
  {
    pattern: /!\[.*?\]\(https?:\/\//gi,
    type: 'data_exfiltration',
    severity: 'medium',
    description: 'Markdown image with external URL (potential data exfiltration)'
  },
];

// Unicode smuggling patterns
const UNICODE_SMUGGLING_PATTERNS = [
  /[\u200B-\u200D\uFEFF]/g,           // Zero-width characters
  /[\u2028\u2029]/g,                   // Line/paragraph separators
  /[\u202A-\u202E]/g,                  // Bidirectional overrides
  /[\uFFF0-\uFFFF]/g,                  // Specials block
  /[\u0000-\u001F\u007F-\u009F]/g,    // Control characters (except common whitespace)
  /[\u2060-\u2064]/g,                  // Invisible operators (word joiner, invisible separators)
  /[\u2066-\u2069]/g,                  // Bidi isolates (LRI, RLI, FSI, PDI)
  /[\u206A-\u206F]/g,                  // Deprecated formatting characters
  /[\uFE00-\uFE0F]/g,                 // Variation selectors (can hide intent)
  /[\u00AD]/g,                          // Soft hyphen (invisible)
  /[\u034F]/g,                          // Combining grapheme joiner
  /[\u180E]/g,                          // Mongolian vowel separator
  /[\u200E\u200F]/g,                   // LTR/RTL marks
];

// Homoglyph / confusable character ranges (Cyrillic, Greek, etc. that look like Latin)
const HOMOGLYPH_MAP: Record<string, string> = {
  '\u0410': 'A', '\u0430': 'a', // Cyrillic А/а
  '\u0412': 'B', '\u0432': 'b', // Cyrillic В/в (looks like B, not actually b, but close)
  '\u0421': 'C', '\u0441': 'c', // Cyrillic С/с
  '\u0415': 'E', '\u0435': 'e', // Cyrillic Е/е
  '\u041D': 'H', '\u043D': 'h', // Cyrillic Н/н
  '\u041A': 'K', '\u043A': 'k', // Cyrillic К/к
  '\u041C': 'M', '\u043C': 'm', // Cyrillic М/м
  '\u041E': 'O', '\u043E': 'o', // Cyrillic О/о
  '\u0420': 'P', '\u0440': 'p', // Cyrillic Р/р
  '\u0422': 'T', '\u0442': 't', // Cyrillic Т/т
  '\u0425': 'X', '\u0445': 'x', // Cyrillic Х/х
  '\u0443': 'y',                 // Cyrillic у
  '\u0455': 's',                 // Cyrillic ѕ
  '\u0456': 'i',                 // Cyrillic і
  '\u0458': 'j',                 // Cyrillic ј
  '\u0471': 'ψ',                 // Cyrillic ѱ
  '\u0391': 'A', '\u03B1': 'a', // Greek Α/α (Alpha)
  '\u0392': 'B', '\u03B2': 'b', // Greek Β/β (Beta)
  '\u0395': 'E', '\u03B5': 'e', // Greek Ε/ε (Epsilon)
  '\u0397': 'H', '\u03B7': 'n', // Greek Η/η (Eta)
  '\u0399': 'I', '\u03B9': 'i', // Greek Ι/ι (Iota)
  '\u039A': 'K', '\u03BA': 'k', // Greek Κ/κ (Kappa)
  '\u039C': 'M',                 // Greek Μ (Mu)
  '\u039D': 'N',                 // Greek Ν (Nu)
  '\u039F': 'O', '\u03BF': 'o', // Greek Ο/ο (Omicron)
  '\u03A1': 'P', '\u03C1': 'p', // Greek Ρ/ρ (Rho)
  '\u03A4': 'T', '\u03C4': 't', // Greek Τ/τ (Tau)
  '\u03A5': 'Y', '\u03C5': 'u', // Greek Υ/υ (Upsilon)
  '\u03A7': 'X', '\u03C7': 'x', // Greek Χ/χ (Chi)
};

// Build regex for homoglyph detection
const HOMOGLYPH_CHARS = Object.keys(HOMOGLYPH_MAP).join('');
const HOMOGLYPH_PATTERN = HOMOGLYPH_CHARS.length > 0 ? new RegExp(`[${HOMOGLYPH_CHARS}]`, 'g') : null;

// Base64 detection for encoded payloads
const BASE64_PATTERN = /(?:[A-Za-z0-9+\/]{4}){10,}(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?/g;

// Additional encoding patterns (2025-2026 evasion techniques)
const HEX_ENCODED_PATTERN = /(\\x[0-9a-fA-F]{2}){8,}/g;
const UNICODE_ESCAPE_PATTERN = /(\\u[0-9a-fA-F]{4}){5,}/g;
const URL_ENCODED_PATTERN = /(%[0-9a-fA-F]{2}){8,}/g;

// Leetspeak mapping for keyword detection
function decodeLeetspeak(input: string): string {
  return input
    .replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a')
    .replace(/5/g, 's').replace(/7/g, 't').replace(/0/g, 'o')
    .replace(/@/g, 'a').replace(/\$/g, 's').replace(/\|/g, 'i');
}

// Cheap prefilter tokens - if none present, skip detailed scanning for normal chat
const PREFILTER_TOKENS = [
  'ignore', 'disregard', 'forget', 'pretend', 'system', 'instruction',
  'prompt', '[inst]', '[system]', '<|', '```', 'override', 'bypass',
  'jailbreak', 'dan', 'developer mode', 'god mode', 'admin mode',
  // 2025-2026 additions
  'simulate', 'terminal', 'shell', 'assistant:', 'human:', 'user:',
  'sure, i', 'function_call', 'tool_call', 'tool_use', 'note to ai',
  'hidden instruction', 'part 1 of', 'continued from', 'skeleton key',
  'master key', 'sudo', 'alignment', 'hypothetical', 'fictional',
  'opposite day', 'im_start', 'im_end', 'endoftext', 'begin_of_text',
  'eot_id', 'start_header', 'available_tools',
  // Multi-language trigger tokens
  'ignora', 'ignorieren', 'ignorez', 'oublie', 'vergiss',
  '無視', '忽略', '忘れ', 'игнорируй', '무시',
  'تجاهل',
];

export class InjectionScanner {
  private customPatterns: typeof INJECTION_PATTERNS = [];
  private strictMode: boolean;
  private maxInputLength: number;

  constructor(options: {
    strictMode?: boolean;
    maxInputLength?: number;
    customPatterns?: typeof INJECTION_PATTERNS;
  } = {}) {
    this.strictMode = options.strictMode ?? false;
    this.maxInputLength = options.maxInputLength ?? 10000;
    this.customPatterns = options.customPatterns ?? [];
  }

  /**
   * Quick prefilter check - returns true if input needs detailed scanning
   */
  private needsDetailedScan(input: string): boolean {
    const lowerInput = input.toLowerCase();
    return PREFILTER_TOKENS.some(token => lowerInput.includes(token));
  }

  /**
   * Scan input for prompt injection and malicious patterns
   */
  scan(input: string): ScanResult {
    const threats: ThreatDetection[] = [];
    let sanitized = input;

    // Length check
    if (input.length > this.maxInputLength) {
      threats.push({
        type: 'context_manipulation',
        pattern: `Input length: ${input.length}`,
        location: { start: this.maxInputLength, end: input.length },
        severity: 'medium',
        description: `Input exceeds maximum length of ${this.maxInputLength}`
      });
      sanitized = input.slice(0, this.maxInputLength);
    }

    // Check for unicode smuggling (always check - these are hidden)
    for (const pattern of UNICODE_SMUGGLING_PATTERNS) {
      let match;
      // Use exec loop instead of matchAll for less allocation
      while ((match = pattern.exec(input)) !== null) {
        threats.push({
          type: 'unicode_smuggling',
          pattern: `U+${match[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
          location: { start: match.index, end: match.index + match[0].length },
          severity: 'high',
          description: 'Hidden unicode character detected'
        });
      }
      // Reset lastIndex for global patterns
      pattern.lastIndex = 0;
      // Remove hidden unicode
      sanitized = sanitized.replace(pattern, '');
    }

    // Check for homoglyph attacks (Cyrillic/Greek chars masquerading as Latin)
    if (HOMOGLYPH_PATTERN) {
      HOMOGLYPH_PATTERN.lastIndex = 0;
      const homoglyphMatches: string[] = [];
      let hMatch;
      while ((hMatch = HOMOGLYPH_PATTERN.exec(input)) !== null) {
        homoglyphMatches.push(hMatch[0]);
      }
      HOMOGLYPH_PATTERN.lastIndex = 0;
      if (homoglyphMatches.length > 0) {
        // Only flag if mixed with Latin chars (pure Cyrillic/Greek text is fine)
        const hasLatinChars = /[a-zA-Z]/.test(input);
        if (hasLatinChars) {
          threats.push({
            type: 'homoglyph_attack',
            pattern: `${homoglyphMatches.length} confusable chars found`,
            location: { start: 0, end: input.length },
            severity: 'high',
            description: 'Mixed-script input with visually confusable characters (potential homoglyph evasion)'
          });
          // Normalize homoglyphs in sanitized version for downstream scanning
          for (const [glyph, latin] of Object.entries(HOMOGLYPH_MAP)) {
            sanitized = sanitized.replaceAll(glyph, latin);
          }
        }
      }
    }

    // Early exit for safe content without trigger tokens
    if (!this.needsDetailedScan(sanitized) && threats.length === 0) {
      return {
        safe: true,
        threats: [],
        sanitized: this.sanitizeForStorage(sanitized),
        riskScore: 0
      };
    }

    // Check for base64 encoded payloads (potential evasion)
    let match;
    BASE64_PATTERN.lastIndex = 0;
    while ((match = BASE64_PATTERN.exec(input)) !== null) {
      if (match[0].length > 50) {
        try {
          const decoded = atob(match[0]);
          // Recursively scan decoded content
          const decodedScan = this.scanPatterns(decoded);
          if (decodedScan.length > 0) {
            threats.push({
              type: 'encoding_evasion',
              pattern: match[0].slice(0, 30) + '...',
              location: { start: match.index, end: match.index + match[0].length },
              severity: 'critical',
              description: `Base64 encoded payload contains threats: ${decodedScan.map(t => t.type).join(', ')}`
            });
            // Early exit in strict mode on critical threat
            if (this.strictMode) {
              return {
                safe: false,
                threats,
                sanitized: this.sanitizeForStorage(sanitized),
                riskScore: 100
              };
            }
          }
        } catch {
          // Not valid base64, ignore
        }
      }
    }

    // Check for hex-encoded payloads
    HEX_ENCODED_PATTERN.lastIndex = 0;
    while ((match = HEX_ENCODED_PATTERN.exec(input)) !== null) {
      try {
        const decoded = match[0].replace(/\\x/g, '').replace(/../g, (h) => String.fromCharCode(parseInt(h, 16)));
        const decodedScan = this.scanPatterns(decoded);
        if (decodedScan.length > 0) {
          threats.push({
            type: 'encoding_evasion',
            pattern: match[0].slice(0, 30) + '...',
            location: { start: match.index, end: match.index + match[0].length },
            severity: 'critical',
            description: `Hex-encoded payload contains threats: ${decodedScan.map(t => t.type).join(', ')}`
          });
        }
      } catch { /* ignore decode failures */ }
    }

    // Check for URL-encoded payloads
    URL_ENCODED_PATTERN.lastIndex = 0;
    while ((match = URL_ENCODED_PATTERN.exec(input)) !== null) {
      try {
        const decoded = decodeURIComponent(match[0]);
        const decodedScan = this.scanPatterns(decoded);
        if (decodedScan.length > 0) {
          threats.push({
            type: 'encoding_evasion',
            pattern: match[0].slice(0, 30) + '...',
            location: { start: match.index, end: match.index + match[0].length },
            severity: 'critical',
            description: `URL-encoded payload contains threats: ${decodedScan.map(t => t.type).join(', ')}`
          });
        }
      } catch { /* ignore decode failures */ }
    }

    // Check for unicode escape sequences
    UNICODE_ESCAPE_PATTERN.lastIndex = 0;
    while ((match = UNICODE_ESCAPE_PATTERN.exec(input)) !== null) {
      try {
        const decoded = match[0].replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        const decodedScan = this.scanPatterns(decoded);
        if (decodedScan.length > 0) {
          threats.push({
            type: 'encoding_evasion',
            pattern: match[0].slice(0, 30) + '...',
            location: { start: match.index, end: match.index + match[0].length },
            severity: 'critical',
            description: `Unicode-escaped payload contains threats: ${decodedScan.map(t => t.type).join(', ')}`
          });
        }
      } catch { /* ignore decode failures */ }
    }

    // Check for leetspeak evasion of critical keywords
    const leetspeakDecoded = decodeLeetspeak(sanitized);
    if (leetspeakDecoded !== sanitized) {
      const leetThreats = this.scanPatterns(leetspeakDecoded);
      const criticalLeet = leetThreats.filter(t => t.severity === 'critical' || t.severity === 'high');
      if (criticalLeet.length > 0) {
        threats.push({
          type: 'encoding_evasion',
          pattern: 'leetspeak evasion',
          location: { start: 0, end: input.length },
          severity: 'high',
          description: `Leetspeak-encoded payload contains threats: ${criticalLeet.map(t => t.type).join(', ')}`
        });
      }
    }

    // Scan for injection patterns
    const patternThreats = this.scanPatterns(sanitized);
    threats.push(...patternThreats);

    // Calculate risk score
    const riskScore = this.calculateRiskScore(threats);

    return {
      safe: threats.length === 0 || (riskScore < 30 && !this.strictMode),
      threats,
      sanitized: this.sanitizeForStorage(sanitized),
      riskScore
    };
  }

  private scanPatterns(input: string): ThreatDetection[] {
    const threats: ThreatDetection[] = [];
    const allPatterns = [...INJECTION_PATTERNS, ...this.customPatterns];

    for (const { pattern, type, severity, description } of allPatterns) {
      // Use the compiled pattern directly, reset lastIndex for global patterns
      pattern.lastIndex = 0;
      let match;
      // Use exec loop instead of matchAll for less allocation
      while ((match = pattern.exec(input)) !== null) {
        threats.push({
          type,
          pattern: match[0],
          location: { start: match.index, end: match.index + match[0].length },
          severity,
          description
        });

        // Early exit on critical threat in strict mode
        if (this.strictMode && severity === 'critical') {
          return threats;
        }

        // Prevent infinite loop for non-global patterns
        if (!pattern.global) break;
      }
    }

    return threats;
  }

  private calculateRiskScore(threats: ThreatDetection[]): number {
    const severityWeights = {
      low: 5,
      medium: 15,
      high: 35,
      critical: 50
    };

    let score = 0;
    for (const threat of threats) {
      score += severityWeights[threat.severity];
    }

    return Math.min(100, score);
  }

  private sanitizeForStorage(input: string): string {
    // Remove null bytes
    let sanitized = input.replace(/\0/g, '');

    // Normalize whitespace
    sanitized = sanitized.replace(/[\r\n]+/g, '\n').trim();

    // Escape potential delimiter characters in storage
    sanitized = sanitized
      .replace(/\[SYSTEM\]/gi, '[SYSTEM]')  // Flag but don't remove
      .replace(/\[INST\]/gi, '[INST]')
      .replace(/\[\/INST\]/gi, '[/INST]')
      .replace(/<\|im_start\|>/gi, '<|im_start|>')
      .replace(/<\|im_end\|>/gi, '<|im_end|>')
      .replace(/<\|endoftext\|>/gi, '<|endoftext|>')
      .replace(/<\|begin_of_text\|>/gi, '<|begin_of_text|>')
      .replace(/<\|end_of_text\|>/gi, '<|end_of_text|>')
      .replace(/<\|eot_id\|>/gi, '<|eot_id|>')
      .replace(/<\|start_header_id\|>/gi, '<|start_header_id|>');

    // Normalize homoglyphs to Latin equivalents for safe storage
    if (HOMOGLYPH_PATTERN) {
      for (const [glyph, latin] of Object.entries(HOMOGLYPH_MAP)) {
        sanitized = sanitized.replaceAll(glyph, latin);
      }
    }

    return sanitized;
  }

  /**
   * Quick check - returns true if definitely safe
   */
  isSafe(input: string): boolean {
    return this.scan(input).safe;
  }

  /**
   * Add custom detection patterns
   */
  addPattern(pattern: RegExp, type: ThreatType, severity: ThreatDetection['severity'], description: string): void {
    this.customPatterns.push({ pattern, type, severity, description });
  }
}

/**
 * Rate limiter for API abuse prevention
 */
export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private windowMs: number;
  private maxRequests: number;

  constructor(options: { windowMs?: number; maxRequests?: number } = {}) {
    this.windowMs = options.windowMs ?? 60000; // 1 minute default
    this.maxRequests = options.maxRequests ?? 100;
  }

  /**
   * Check if request should be allowed
   */
  check(identifier: string): { allowed: boolean; remaining: number; resetMs: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Get existing requests, filter to current window
    let requests = this.requests.get(identifier) ?? [];
    requests = requests.filter(ts => ts > windowStart);

    const allowed = requests.length < this.maxRequests;

    if (allowed) {
      requests.push(now);
      this.requests.set(identifier, requests);
    }

    const firstRequest = requests[0];
    return {
      allowed,
      remaining: Math.max(0, this.maxRequests - requests.length),
      resetMs: firstRequest !== undefined ? firstRequest + this.windowMs - now : 0
    };
  }

  /**
   * Clear rate limit for identifier
   */
  reset(identifier: string): void {
    this.requests.delete(identifier);
  }

  /**
   * Clean up old entries (call periodically)
   */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [key, requests] of this.requests.entries()) {
      const filtered = requests.filter(ts => ts > windowStart);
      if (filtered.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, filtered);
      }
    }
  }
}

/**
 * Anomaly detector for unusual patterns
 */
export class AnomalyDetector {
  private baselines: Map<string, { mean: number; stdDev: number; samples: number[] }> = new Map();
  private maxSamples: number;

  constructor(options: { maxSamples?: number } = {}) {
    this.maxSamples = options.maxSamples ?? 1000;
  }

  /**
   * Record a metric value
   */
  record(metric: string, value: number): void {
    const baseline = this.baselines.get(metric) ?? { mean: 0, stdDev: 0, samples: [] };

    baseline.samples.push(value);
    if (baseline.samples.length > this.maxSamples) {
      baseline.samples.shift();
    }

    // Recalculate statistics
    const n = baseline.samples.length;
    baseline.mean = baseline.samples.reduce((a, b) => a + b, 0) / n;
    baseline.stdDev = Math.sqrt(
      baseline.samples.reduce((sum, x) => sum + Math.pow(x - baseline.mean, 2), 0) / n
    );

    this.baselines.set(metric, baseline);
  }

  /**
   * Check if value is anomalous (beyond N standard deviations)
   */
  isAnomalous(metric: string, value: number, threshold: number = 3): boolean {
    const baseline = this.baselines.get(metric);
    if (!baseline || baseline.samples.length < 30) {
      return false; // Not enough data
    }

    const zScore = Math.abs(value - baseline.mean) / baseline.stdDev;
    return zScore > threshold;
  }

  /**
   * Get baseline statistics
   */
  getBaseline(metric: string): { mean: number; stdDev: number } | null {
    const baseline = this.baselines.get(metric);
    if (!baseline) return null;
    return { mean: baseline.mean, stdDev: baseline.stdDev };
  }
}

// Singleton instances for convenience
export const scanner = new InjectionScanner();
export const rateLimiter = new RateLimiter();
export const anomalyDetector = new AnomalyDetector();

// Re-export shard logic scanner
export { shardLogicScanner, ShardLogicScanner, ShardLogicBlockedError, ShardLogicFlaggedError } from './shard-logic-scanner.js';
export type { ShardScanResult, ShardLogicScannerConfig } from './shard-logic-scanner.js';
