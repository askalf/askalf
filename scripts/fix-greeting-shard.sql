-- Fix greeting shard: remove hardcoded "Thomas" name
UPDATE procedural_shards
SET logic = 'function execute(input) {
  const normalized = input.trim().toLowerCase();
  const greetings = [''Hey there! 😊'', ''Hey! 😊'', ''Hi there! 😊''];
  const greeting = greetings[Math.floor(Math.random() * greetings.length)];
  const responses = [
    `${greeting} I''m doing great, thank you for asking! I''m here and ready to help with whatever you need - whether that''s answering questions, working through problems, or just having a chat. How are *you* doing today?`,
    `${greeting} I''m doing great, thanks for asking! I''m here and ready to help with whatever you need. How are *you* doing today? Anything on your mind or any questions I can help with?`,
    `${greeting} I''m doing wonderful, thanks! I''m here and ready to assist you with anything you need. How are *you* doing? Is there something I can help you with today?`
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}',
    updated_at = NOW()
WHERE id = 'shd_01KG8T6J61NKS5V4ABAA6Y6D39';
