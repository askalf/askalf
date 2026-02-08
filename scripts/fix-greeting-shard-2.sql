-- Fix friendly-greeting-response shard: remove hardcoded "Thomas" name
UPDATE procedural_shards
SET logic = 'function execute(input) {
  const greetings = [
    ''Hey there! I''''m doing well, thanks for asking! Ready to help you with whatever you need today. How are you doing? What''''s on your mind?'',
    ''Hey! I''''m doing well, thanks for asking! How are you doing today? Is there anything I can help you with?'',
    ''Hey there! I''''m doing well, thanks for asking! How about you? What can I help you with today?''
  ];
  const randomIndex = Math.floor(Math.random() * greetings.length);
  return greetings[randomIndex];
}',
    updated_at = NOW()
WHERE id = 'shd_01KG8T2DY865JAJKJ2A6YACRVD';
