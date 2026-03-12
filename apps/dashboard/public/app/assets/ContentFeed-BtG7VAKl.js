import{r as g,j as e}from"./index-BnZH34C5.js";import{u as o}from"./UnifiedDashboard-CzEjfVyE.js";import{u as V}from"./usePolling-B187lrtg.js";import{S as L}from"./StatusBadge-BsqC2qKl.js";import{P as X}from"./PaginationBar-CmQfYBXx.js";import{M as Y}from"./Modal-DLCzAtgj.js";import{E as Z}from"./EmptyState-CfD8J_EO.js";import"./theme-D5gF2Tvy.js";const O=r=>new Date(r).toLocaleString(void 0,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}),ee=r=>r?new Date(r).toLocaleString(void 0,{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"}):"-",M=r=>r>0?`$${r.toFixed(4)}`:"-",R=r=>r>0?r.toLocaleString():"-",J=r=>r<=0?"-":r<1e3?`${r}ms`:`${(r/1e3).toFixed(1)}s`;function C(r){const m=r.split(`
`),i=[];let d=!1,h=[],u="";const l=c=>{const s=[];let x=c,y=0;for(;x.length>0;){const p=x.match(/\*\*(.+?)\*\*/),n=x.match(/`(.+?)`/);let a=null;if(p&&p.index!==void 0&&(a={type:"bold",match:p}),n&&n.index!==void 0&&(!a||n.index<a.match.index)&&(a={type:"code",match:n}),!a){s.push(x);break}const j=a.match.index;j>0&&s.push(x.slice(0,j)),a.type==="bold"?s.push(e.jsx("strong",{children:a.match[1]},`b-${y++}`)):s.push(e.jsx("code",{className:"cf-inline-code",children:a.match[1]},`c-${y++}`)),x=x.slice(j+a.match[0].length)}return s};for(let c=0;c<m.length;c++){const s=m[c];if(s.startsWith("```")){d?(i.push(e.jsxs("pre",{className:"cf-code-block",children:[u&&e.jsx("span",{className:"cf-code-lang",children:u}),e.jsx("code",{children:h.join(`
`)})]},`code-${c}`)),h=[],u="",d=!1):(d=!0,u=s.slice(3).trim());continue}if(d){h.push(s);continue}s.startsWith("### ")?i.push(e.jsx("h4",{className:"cf-md-h4",children:l(s.slice(4))},c)):s.startsWith("## ")?i.push(e.jsx("h3",{className:"cf-md-h3",children:l(s.slice(3))},c)):s.startsWith("# ")?i.push(e.jsx("h2",{className:"cf-md-h2",children:l(s.slice(2))},c)):s.startsWith("- ")||s.startsWith("* ")?i.push(e.jsx("div",{className:"cf-list-item",children:l(s.slice(2))},c)):/^\d+\.\s/.test(s)?i.push(e.jsx("div",{className:"cf-list-item numbered",children:l(s)},c)):s.trim()===""?i.push(e.jsx("div",{className:"cf-spacer"},c)):i.push(e.jsx("div",{className:"cf-line",children:l(s)},c))}return d&&h.length>0&&i.push(e.jsx("pre",{className:"cf-code-block",children:e.jsx("code",{children:h.join(`
`)})},"code-end")),i}function te({source:r}){return r==="execution"?e.jsx("span",{className:"cf-source-icon cf-source-execution",title:"Execution Output",children:e.jsxs("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[e.jsx("polyline",{points:"4 17 10 11 4 5"}),e.jsx("line",{x1:"12",y1:"19",x2:"20",y2:"19"})]})}):r==="resolution"?e.jsx("span",{className:"cf-source-icon cf-source-resolution",title:"Resolved Ticket",children:e.jsx("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:e.jsx("polyline",{points:"20 6 9 17 4 12"})})}):e.jsx("span",{className:"cf-source-icon cf-source-finding",title:"Finding",children:e.jsxs("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[e.jsx("circle",{cx:"12",cy:"12",r:"10"}),e.jsx("line",{x1:"12",y1:"8",x2:"12",y2:"12"}),e.jsx("line",{x1:"12",y1:"16",x2:"12.01",y2:"16"})]})})}function de(){const r=o(t=>t.contentItems),m=o(t=>t.contentPagination),i=o(t=>t.contentPage),d=o(t=>t.contentAgentFilter),h=o(t=>t.contentSourceFilter),u=o(t=>t.contentSeverityFilter),l=o(t=>t.contentCategoryFilter),c=o(t=>t.contentDateFrom),s=o(t=>t.contentDateTo),x=o(t=>t.contentSearch),y=o(t=>t.contentAgents),p=o(t=>t.contentCategories),n=o(t=>t.selectedContentItem),a=o(t=>t.loading),j=o(t=>t.setContentPage),w=o(t=>t.setContentAgentFilter),A=o(t=>t.setContentSourceFilter),B=o(t=>t.setContentSeverityFilter),z=o(t=>t.setContentCategoryFilter),D=o(t=>t.setContentDateFrom),T=o(t=>t.setContentDateTo),N=o(t=>t.setContentSearch),I=o(t=>t.setSelectedContentItem),b=o(t=>t.fetchContentFeed),P=o(t=>t.fetchContentAgents),W=o(t=>t.fetchContentCategories),[k,$]=g.useState(""),[F,H]=g.useState(!1);g.useEffect(()=>{const t=setTimeout(()=>N(k),300);return()=>clearTimeout(t)},[k,N]),g.useEffect(()=>{P(),W()},[P,W]),g.useEffect(()=>{b()},[i,d,h,u,l,c,s,x,b]);const U=g.useCallback(()=>{b()},[b]);V(U,3e4);const E=d||h||u||l||c||s,q=()=>{$(""),N(""),w(""),A(""),B(""),z(""),D(""),T("")},G=t=>t==="execution"?"output":t==="resolution"?"resolution":"finding",K=t=>{if(t.title)return t.title;if(t.source==="execution"&&t.input){const v=typeof t.input=="string"?t.input:JSON.stringify(t.input);return v.length>120?v.slice(0,120)+"…":v}if(t.content){const f=(t.content.split(`
`).find(S=>S.trim())||"").replace(/^#+\s*/,"").trim();return f.length>120?f.slice(0,120)+"…":f}return"Untitled"},_=t=>{if(!t.content)return"";const f=t.content.split(`
`).filter(S=>S.trim()).slice(1).join(" ").replace(/[#*`]/g,"").trim();return f.length>200?f.slice(0,200)+"…":f},Q=t=>t.source==="execution"?"Execution Output":t.source==="resolution"?t.title||"Resolution Detail":"Finding Detail";return e.jsxs(e.Fragment,{children:[e.jsxs("div",{className:"cf-search-bar",children:[e.jsxs("div",{className:"cf-search-input-wrap",children:[e.jsxs("svg",{className:"cf-search-icon",width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[e.jsx("circle",{cx:"11",cy:"11",r:"8"}),e.jsx("line",{x1:"21",y1:"21",x2:"16.65",y2:"16.65"})]}),e.jsx("input",{type:"text",className:"cf-search-input",value:k,onChange:t=>$(t.target.value),placeholder:"Search content, findings, and resolutions...","aria-label":"Search content"})]}),e.jsxs("button",{className:`cf-advanced-toggle ${F?"active":""}`,onClick:()=>H(!F),"aria-label":"Toggle advanced filters",title:"Advanced filters",children:[e.jsxs("svg",{width:"16",height:"16",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[e.jsx("line",{x1:"4",y1:"21",x2:"4",y2:"14"}),e.jsx("line",{x1:"4",y1:"10",x2:"4",y2:"3"}),e.jsx("line",{x1:"12",y1:"21",x2:"12",y2:"12"}),e.jsx("line",{x1:"12",y1:"8",x2:"12",y2:"3"}),e.jsx("line",{x1:"20",y1:"21",x2:"20",y2:"16"}),e.jsx("line",{x1:"20",y1:"12",x2:"20",y2:"3"}),e.jsx("line",{x1:"1",y1:"14",x2:"7",y2:"14"}),e.jsx("line",{x1:"9",y1:"8",x2:"15",y2:"8"}),e.jsx("line",{x1:"17",y1:"16",x2:"23",y2:"16"})]}),E&&e.jsx("span",{className:"cf-filter-dot"})]})]}),F&&e.jsxs("div",{className:"cf-advanced-panel",children:[e.jsxs("div",{className:"cf-advanced-grid",children:[e.jsxs("div",{className:"cf-filter-group",children:[e.jsx("label",{children:"Agent"}),e.jsxs("select",{value:d,onChange:t=>w(t.target.value),children:[e.jsx("option",{value:"",children:"All Agents"}),y.map(t=>e.jsx("option",{value:t,children:t},t))]})]}),e.jsxs("div",{className:"cf-filter-group",children:[e.jsx("label",{children:"Source"}),e.jsxs("select",{value:h,onChange:t=>A(t.target.value),children:[e.jsx("option",{value:"",children:"All Sources"}),e.jsx("option",{value:"execution",children:"Execution Outputs"}),e.jsx("option",{value:"finding",children:"Findings"}),e.jsx("option",{value:"resolution",children:"Resolutions"})]})]}),e.jsxs("div",{className:"cf-filter-group",children:[e.jsx("label",{children:"Severity"}),e.jsxs("select",{value:u,onChange:t=>B(t.target.value),children:[e.jsx("option",{value:"",children:"All Severities"}),e.jsx("option",{value:"critical",children:"Critical"}),e.jsx("option",{value:"warning",children:"Warning"}),e.jsx("option",{value:"info",children:"Info"})]})]}),e.jsxs("div",{className:"cf-filter-group",children:[e.jsx("label",{children:"Category"}),e.jsxs("select",{value:l,onChange:t=>z(t.target.value),children:[e.jsx("option",{value:"",children:"All Categories"}),p.map(t=>e.jsx("option",{value:t,children:t},t))]})]}),e.jsxs("div",{className:"cf-filter-group",children:[e.jsx("label",{children:"From"}),e.jsx("input",{type:"date",value:c,onChange:t=>D(t.target.value)})]}),e.jsxs("div",{className:"cf-filter-group",children:[e.jsx("label",{children:"To"}),e.jsx("input",{type:"date",value:s,onChange:t=>T(t.target.value)})]})]}),E&&e.jsx("button",{className:"hub-btn hub-btn--small cf-clear-btn",onClick:q,children:"Clear All Filters"})]}),a.content&&r.length===0?e.jsx("div",{className:"hub-loading-state",children:"Loading content..."}):r.length===0?e.jsx(Z,{icon:"📝",title:"No content yet",message:"Run agents to generate outputs, findings, and resolutions."}):e.jsxs(e.Fragment,{children:[e.jsx("div",{className:"cf-content-list",children:r.map(t=>e.jsxs("div",{className:`cf-content-card ${t.source}`,onClick:()=>I(t),children:[e.jsxs("div",{className:"cf-content-header",children:[e.jsx(te,{source:t.source}),e.jsx("span",{className:"cf-content-agent",children:t.agent_name}),e.jsx("span",{className:`cf-content-source-tag ${t.source}`,children:G(t.source)}),t.severity&&e.jsx(L,{status:t.severity}),t.category&&e.jsx("span",{className:"cf-content-category",children:t.category}),e.jsx("span",{className:"cf-content-time",children:O(t.sort_date)})]}),e.jsx("h3",{className:"cf-content-title",children:K(t)}),_(t)&&e.jsx("p",{className:"cf-content-preview",children:_(t)}),e.jsxs("div",{className:"cf-content-footer",children:[t.tokens>0&&e.jsxs("span",{className:"cf-content-meta",children:[R(t.tokens)," tokens"]}),t.cost>0&&e.jsx("span",{className:"cf-content-meta",children:M(t.cost)}),t.duration_ms>0&&e.jsx("span",{className:"cf-content-meta",children:J(t.duration_ms)})]})]},`${t.source}-${t.id}`))}),e.jsx(X,{pagination:m,currentPage:i,onPageChange:j})]}),n&&e.jsx(Y,{title:Q(n),onClose:()=>I(null),size:"medium",children:e.jsxs("div",{className:"cf-detail",children:[e.jsxs("div",{className:"hub-hist-detail-grid",style:{marginBottom:"var(--space-lg)"},children:[e.jsx("div",{children:e.jsx("strong",{children:"Source:"})}),e.jsx("div",{style:{textTransform:"capitalize"},children:n.source}),e.jsx("div",{children:e.jsx("strong",{children:"Agent:"})}),e.jsx("div",{children:n.agent_name}),n.severity&&e.jsxs(e.Fragment,{children:[e.jsx("div",{children:e.jsx("strong",{children:"Severity:"})}),e.jsx("div",{children:e.jsx(L,{status:n.severity})})]}),n.category&&e.jsxs(e.Fragment,{children:[e.jsx("div",{children:e.jsx("strong",{children:"Category:"})}),e.jsx("div",{children:n.category})]}),e.jsx("div",{children:e.jsx("strong",{children:"Date:"})}),e.jsx("div",{children:ee(n.sort_date)}),n.tokens>0&&e.jsxs(e.Fragment,{children:[e.jsx("div",{children:e.jsx("strong",{children:"Tokens:"})}),e.jsx("div",{children:R(n.tokens)})]}),n.cost>0&&e.jsxs(e.Fragment,{children:[e.jsx("div",{children:e.jsx("strong",{children:"Cost:"})}),e.jsx("div",{children:M(n.cost)})]}),n.duration_ms>0&&e.jsxs(e.Fragment,{children:[e.jsx("div",{children:e.jsx("strong",{children:"Duration:"})}),e.jsx("div",{children:J(n.duration_ms)})]}),n.execution_id&&e.jsxs(e.Fragment,{children:[e.jsx("div",{children:e.jsx("strong",{children:"Execution:"})}),e.jsx("div",{style:{fontFamily:"monospace",fontSize:"0.75rem"},children:n.execution_id})]})]}),n.source==="resolution"&&n.description&&e.jsxs("div",{style:{marginBottom:"var(--space-md)"},children:[e.jsx("strong",{style:{display:"block",marginBottom:"var(--space-xs)",color:"var(--text-secondary)",fontSize:"0.8rem"},children:"Original Problem"}),e.jsx("div",{className:"cf-markdown-body",children:C(n.description)})]}),n.input&&n.source==="execution"&&e.jsxs("div",{style:{marginBottom:"var(--space-md)"},children:[e.jsx("strong",{style:{display:"block",marginBottom:"var(--space-xs)",color:"var(--text-secondary)",fontSize:"0.8rem"},children:"Task / Input"}),e.jsx("div",{className:"cf-markdown-body",style:{maxHeight:"150px"},children:C(typeof n.input=="string"?n.input:JSON.stringify(n.input,null,2))})]}),e.jsxs("div",{style:{marginBottom:"var(--space-md)"},children:[e.jsx("strong",{style:{display:"block",marginBottom:"var(--space-xs)",color:"var(--text-secondary)",fontSize:"0.8rem"},children:n.source==="execution"?"Output":n.source==="resolution"?"Resolution":"Finding"}),e.jsx("div",{className:"cf-markdown-body",children:C(n.content||"")})]}),n.source==="resolution"&&n.notes&&n.notes.length>0&&e.jsxs("div",{style:{marginBottom:"var(--space-md)"},children:[e.jsxs("strong",{style:{display:"block",marginBottom:"var(--space-xs)",color:"var(--text-secondary)",fontSize:"0.8rem"},children:["Agent Notes (",n.notes.length,")"]}),e.jsx("div",{className:"cf-notes-thread",children:n.notes.map(t=>e.jsxs("div",{className:"cf-note",children:[e.jsxs("div",{className:"cf-note-header",children:[e.jsx("span",{className:"cf-note-author",children:t.author}),e.jsx("span",{className:"cf-note-time",children:O(t.created_at)})]}),e.jsx("div",{className:"cf-markdown-body",style:{padding:"var(--space-sm)",fontSize:"0.825rem"},children:C(t.content)})]},t.id))})]}),n.metadata&&Object.keys(n.metadata).length>0&&e.jsxs("div",{style:{marginBottom:"var(--space-md)"},children:[e.jsx("strong",{style:{display:"block",marginBottom:"var(--space-xs)",color:"var(--text-secondary)",fontSize:"0.8rem"},children:"Metadata"}),e.jsx("div",{className:"hub-hist-detail-output",style:{maxHeight:"200px"},children:JSON.stringify(n.metadata,null,2)})]})]})}),e.jsx("style",{children:`
        .cf-markdown-body {
          background: var(--surface-alt, var(--bg-secondary, rgba(0,0,0,0.15)));
          border-radius: 8px;
          padding: var(--space-md);
          font-size: 0.875rem;
          line-height: 1.6;
          color: var(--text);
          max-height: 500px;
          overflow-y: auto;
        }
        .cf-md-h2 { font-size: 1.1rem; font-weight: 700; margin: var(--space-sm) 0 var(--space-xs); color: var(--text); }
        .cf-md-h3 { font-size: 1rem; font-weight: 600; margin: var(--space-sm) 0 var(--space-xs); color: var(--text); }
        .cf-md-h4 { font-size: 0.9rem; font-weight: 600; margin: var(--space-xs) 0; color: var(--text-secondary); }
        .cf-line { margin-bottom: 2px; }
        .cf-spacer { height: var(--space-xs); }
        .cf-list-item { padding-left: 1rem; position: relative; margin-bottom: 2px; }
        .cf-list-item::before { content: '\\2022'; position: absolute; left: 0; color: var(--text-secondary); }
        .cf-list-item.numbered::before { content: none; }
        .cf-inline-code {
          background: rgba(255,255,255,0.06);
          padding: 1px 5px;
          border-radius: 3px;
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
          font-size: 0.8em;
        }
        .cf-code-block {
          background: rgba(0,0,0,0.3);
          border-radius: 6px;
          padding: var(--space-sm) var(--space-md);
          margin: var(--space-xs) 0;
          overflow-x: auto;
          font-size: 0.8rem;
          line-height: 1.5;
          position: relative;
        }
        .cf-code-block code {
          font-family: 'JetBrains Mono', 'Fira Code', monospace;
        }
        .cf-code-lang {
          position: absolute;
          top: 4px;
          right: 8px;
          font-size: 0.65rem;
          color: var(--text-secondary);
          opacity: 0.6;
          text-transform: uppercase;
        }
        .cf-source-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .cf-source-execution { background: rgba(139, 92, 246, 0.15); color: #a78bfa; }
        .cf-source-finding { background: rgba(250, 204, 21, 0.15); color: #facc15; }
        .cf-source-resolution { background: rgba(74, 222, 128, 0.15); color: #4ade80; }
        .cf-notes-thread {
          display: flex;
          flex-direction: column;
          gap: var(--space-sm);
        }
        .cf-note {
          border-left: 3px solid var(--border);
          padding-left: var(--space-sm);
        }
        .cf-note-header {
          display: flex;
          align-items: center;
          gap: var(--space-sm);
          margin-bottom: 4px;
        }
        .cf-note-author {
          font-weight: 600;
          font-size: 0.8rem;
          color: var(--color-primary, #818cf8);
        }
        .cf-note-time {
          font-size: 0.7rem;
          color: var(--text-secondary);
        }
        .cf-content-category {
          font-size: 0.7rem;
          padding: 1px 6px;
          border-radius: 3px;
          background: rgba(255,255,255,0.06);
          color: var(--text-secondary);
        }
        .hub-loading-state {
          text-align: center;
          padding: var(--space-xl);
          color: var(--text-secondary);
          font-size: 0.9rem;
        }
      `})]})}export{de as default};
