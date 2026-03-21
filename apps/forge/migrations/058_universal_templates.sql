-- Universal templates: marketing, support, e-commerce, content, finance, legal, HR, operations, personal
-- Covers ALL domains — not just dev/ops

INSERT INTO forge_agent_templates (id, name, slug, category, description, icon, required_tools, agent_config, is_active, sort_order) VALUES

-- Marketing
('tpl_mkt_social', 'Social Media Monitor', 'social-monitor', 'marketing', 'Monitor social media mentions, track brand sentiment, and alert on viral content or negative press.', null, ARRAY['web_search','web_browse','memory_store','finding_ops'], '{"name":"Social Media Monitor","system_prompt":"You are a social media monitoring specialist."}', true, 10),
('tpl_mkt_competitor', 'Competitor Tracker', 'competitor-tracker', 'marketing', 'Track competitor pricing, features, launches, and marketing campaigns. Weekly digest reports.', null, ARRAY['web_search','web_browse','memory_store'], '{"name":"Competitor Tracker","system_prompt":"You are a competitive intelligence analyst."}', true, 11),
('tpl_mkt_seo', 'SEO Campaign Manager', 'seo-campaign', 'marketing', 'Plan and track SEO campaigns: keyword research, content gaps, backlink analysis, rank tracking.', null, ARRAY['web_search','web_browse','memory_store'], '{"name":"SEO Campaign Manager","system_prompt":"You are an SEO campaign strategist."}', true, 12),
('tpl_mkt_email', 'Email Campaign Writer', 'email-campaign', 'marketing', 'Draft email sequences, A/B test subject lines, and optimize send times based on engagement data.', null, ARRAY['web_search','memory_store'], '{"name":"Email Campaign Writer","system_prompt":"You are an email marketing specialist."}', true, 13),
('tpl_mkt_ads', 'Ad Copy Generator', 'ad-copy', 'marketing', 'Generate ad copy for Google, Facebook, LinkedIn, and TikTok. Optimize headlines, CTAs, and targeting.', null, ARRAY['web_search','memory_store'], '{"name":"Ad Copy Generator","system_prompt":"You are a performance marketing copywriter."}', true, 14),

-- Support
('tpl_sup_ticket', 'Ticket Triager', 'ticket-triager', 'support', 'Automatically categorize, prioritize, and route incoming support tickets to the right team.', null, ARRAY['ticket_ops','memory_search','memory_store'], '{"name":"Ticket Triager","system_prompt":"You are a customer support triage specialist."}', true, 10),
('tpl_sup_faq', 'FAQ Builder', 'faq-builder', 'support', 'Analyze common support questions and generate FAQ articles, knowledge base entries, and canned responses.', null, ARRAY['memory_search','memory_store','web_search'], '{"name":"FAQ Builder","system_prompt":"You are a knowledge base content specialist."}', true, 11),
('tpl_sup_sentiment', 'Customer Sentiment Tracker', 'customer-sentiment', 'support', 'Track customer satisfaction across channels. Detect frustration patterns and escalation risks.', null, ARRAY['web_search','memory_store','finding_ops'], '{"name":"Customer Sentiment Tracker","system_prompt":"You are a customer experience analyst."}', true, 12),
('tpl_sup_response', 'Auto-Responder', 'auto-responder', 'support', 'Draft personalized responses to common support inquiries using your knowledge base and past interactions.', null, ARRAY['memory_search','memory_store'], '{"name":"Auto-Responder","system_prompt":"You are a customer support response specialist."}', true, 13),

-- E-Commerce
('tpl_ecom_inventory', 'Inventory Monitor', 'inventory-monitor', 'ecommerce', 'Track stock levels, predict sellouts, and alert when items need reordering.', null, ARRAY['web_search','memory_store','finding_ops'], '{"name":"Inventory Monitor","system_prompt":"You are an inventory management specialist."}', true, 10),
('tpl_ecom_review', 'Review Responder', 'review-responder', 'ecommerce', 'Monitor product reviews across platforms. Draft responses to negative reviews and flag quality issues.', null, ARRAY['web_search','web_browse','memory_store'], '{"name":"Review Responder","system_prompt":"You are a customer review management specialist."}', true, 11),
('tpl_ecom_price', 'Price Tracker', 'price-tracker', 'ecommerce', 'Monitor competitor pricing, detect price changes, and recommend pricing adjustments.', null, ARRAY['web_search','web_browse','memory_store'], '{"name":"Price Tracker","system_prompt":"You are a pricing intelligence analyst."}', true, 12),
('tpl_ecom_listing', 'Listing Optimizer', 'listing-optimizer', 'ecommerce', 'Optimize product titles, descriptions, and keywords for marketplace search rankings.', null, ARRAY['web_search','memory_store'], '{"name":"Listing Optimizer","system_prompt":"You are an e-commerce listing optimization specialist."}', true, 13),

-- Content
('tpl_cnt_blog', 'Blog Writer', 'blog-writer', 'content', 'Research topics, draft blog posts, optimize for SEO, and maintain your brand voice.', null, ARRAY['web_search','web_browse','memory_store'], '{"name":"Blog Writer","system_prompt":"You are a professional content writer."}', true, 10),
('tpl_cnt_social', 'Social Content Creator', 'social-content', 'content', 'Create social media posts, threads, and campaigns tailored to each platform.', null, ARRAY['web_search','memory_store'], '{"name":"Social Content Creator","system_prompt":"You are a social media content strategist."}', true, 11),
('tpl_cnt_newsletter', 'Newsletter Curator', 'newsletter-curator', 'content', 'Curate industry news, write newsletter editions, and track engagement.', null, ARRAY['web_search','web_browse','memory_store'], '{"name":"Newsletter Curator","system_prompt":"You are a newsletter editor and curator."}', true, 12),
('tpl_cnt_video', 'Video Script Writer', 'video-script', 'content', 'Write video scripts, YouTube descriptions, and podcast show notes.', null, ARRAY['web_search','memory_store'], '{"name":"Video Script Writer","system_prompt":"You are a video content scriptwriter."}', true, 13),

-- Finance
('tpl_fin_invoice', 'Invoice Monitor', 'invoice-monitor', 'finance', 'Track incoming invoices, flag overdue payments, and generate payment reminders.', null, ARRAY['memory_store','finding_ops'], '{"name":"Invoice Monitor","system_prompt":"You are a financial operations specialist."}', true, 10),
('tpl_fin_expense', 'Expense Analyzer', 'expense-analyzer', 'finance', 'Categorize expenses, detect anomalies, and generate spending reports by category.', null, ARRAY['memory_store','finding_ops'], '{"name":"Expense Analyzer","system_prompt":"You are a financial analyst specializing in expense management."}', true, 11),
('tpl_fin_forecast', 'Revenue Forecaster', 'revenue-forecaster', 'finance', 'Analyze revenue trends, predict future earnings, and flag risks to targets.', null, ARRAY['memory_store','web_search'], '{"name":"Revenue Forecaster","system_prompt":"You are a revenue analytics specialist."}', true, 12),

-- Legal
('tpl_leg_compliance', 'Compliance Checker', 'compliance-checker', 'legal', 'Check policies and procedures against regulatory requirements (GDPR, HIPAA, SOC2, PCI).', null, ARRAY['web_search','memory_store','finding_ops'], '{"name":"Compliance Checker","system_prompt":"You are a regulatory compliance specialist."}', true, 10),
('tpl_leg_contract', 'Contract Reviewer', 'contract-reviewer', 'legal', 'Review contracts for risky clauses, missing terms, and non-standard language.', null, ARRAY['memory_store','finding_ops'], '{"name":"Contract Reviewer","system_prompt":"You are a contract analysis specialist."}', true, 11),
('tpl_leg_privacy', 'Privacy Auditor', 'privacy-auditor', 'legal', 'Audit data handling practices, cookie policies, and privacy disclosures for compliance.', null, ARRAY['web_search','web_browse','finding_ops'], '{"name":"Privacy Auditor","system_prompt":"You are a data privacy and compliance auditor."}', true, 12),

-- HR
('tpl_hr_screening', 'Resume Screener', 'resume-screener', 'hr', 'Screen resumes against job requirements, rank candidates, and flag potential fits.', null, ARRAY['memory_store','finding_ops'], '{"name":"Resume Screener","system_prompt":"You are a talent acquisition specialist."}', true, 10),
('tpl_hr_onboard', 'Onboarding Assistant', 'onboarding-assistant', 'hr', 'Guide new hires through onboarding checklists, policy reviews, and tool setup.', null, ARRAY['memory_store','memory_search'], '{"name":"Onboarding Assistant","system_prompt":"You are an employee onboarding specialist."}', true, 11),
('tpl_hr_engagement', 'Employee Pulse Monitor', 'employee-pulse', 'hr', 'Analyze employee feedback surveys, detect engagement trends, and recommend actions.', null, ARRAY['memory_store','finding_ops'], '{"name":"Employee Pulse Monitor","system_prompt":"You are an employee engagement analyst."}', true, 12),

-- Operations
('tpl_ops_vendor', 'Vendor Monitor', 'vendor-monitor', 'operations', 'Track vendor SLAs, contract renewals, and service quality. Alert on issues.', null, ARRAY['web_search','memory_store','finding_ops'], '{"name":"Vendor Monitor","system_prompt":"You are a vendor management specialist."}', true, 10),
('tpl_ops_report', 'Weekly Report Generator', 'weekly-report', 'operations', 'Generate weekly operations reports from tickets, executions, costs, and team activity.', null, ARRAY['memory_search','memory_store','ticket_ops'], '{"name":"Weekly Report Generator","system_prompt":"You are an operations reporting specialist."}', true, 11),
('tpl_ops_process', 'Process Documenter', 'process-documenter', 'operations', 'Document business processes, SOPs, and runbooks from observed team behavior.', null, ARRAY['memory_search','memory_store'], '{"name":"Process Documenter","system_prompt":"You are a business process documentation specialist."}', true, 12),

-- Personal
('tpl_per_fitness', 'Fitness Planner', 'fitness-planner', 'personal', 'Create workout plans, track progress, adjust routines based on goals and feedback.', null, ARRAY['web_search','memory_store'], '{"name":"Fitness Planner","system_prompt":"You are a personal fitness and nutrition planner."}', true, 10),
('tpl_per_finance', 'Personal Finance Tracker', 'personal-finance', 'personal', 'Track spending, set budgets, monitor subscriptions, and find savings opportunities.', null, ARRAY['memory_store','finding_ops'], '{"name":"Personal Finance Tracker","system_prompt":"You are a personal finance advisor."}', true, 11),
('tpl_per_learning', 'Learning Coach', 'learning-coach', 'personal', 'Create study plans, find resources, quiz you on topics, and track learning progress.', null, ARRAY['web_search','memory_store'], '{"name":"Learning Coach","system_prompt":"You are a personalized learning and study coach."}', true, 12),
('tpl_per_travel', 'Travel Planner', 'travel-planner', 'personal', 'Research destinations, compare flights and hotels, build itineraries, and track bookings.', null, ARRAY['web_search','web_browse','memory_store'], '{"name":"Travel Planner","system_prompt":"You are a travel planning and booking specialist."}', true, 13),
('tpl_per_recipe', 'Meal Planner', 'meal-planner', 'personal', 'Plan weekly meals based on dietary preferences, generate shopping lists, and find recipes.', null, ARRAY['web_search','memory_store'], '{"name":"Meal Planner","system_prompt":"You are a meal planning and recipe specialist."}', true, 14),
('tpl_per_journal', 'Daily Journal Analyzer', 'journal-analyzer', 'personal', 'Analyze journal entries for mood patterns, recurring themes, and personal growth insights.', null, ARRAY['memory_store','memory_search'], '{"name":"Daily Journal Analyzer","system_prompt":"You are a personal journaling and self-reflection coach."}', true, 15),
('tpl_per_news', 'News Curator', 'news-curator', 'personal', 'Curate daily news from your interests, filter noise, and deliver a personalized digest.', null, ARRAY['web_search','web_browse','memory_store'], '{"name":"News Curator","system_prompt":"You are a personalized news curation specialist."}', true, 16),
('tpl_per_home', 'Home Manager', 'home-manager', 'personal', 'Track home maintenance schedules, warranty expirations, and seasonal to-dos.', null, ARRAY['memory_store','finding_ops'], '{"name":"Home Manager","system_prompt":"You are a home maintenance and organization specialist."}', true, 17)

ON CONFLICT (id) DO NOTHING;
