/**
 * Root launcher - builds and starts Memo_v2 server
 * 
 * This file is kept for backward compatibility.
 * The actual server now runs from Memo_v2/src/server.ts
 */

import dotenv from 'dotenv';

dotenv.config();

// Build and start Memo_v2 server
// The server entry point is now Memo_v2/src/server.ts
// This file can be removed once migration is complete

console.log('🚀 Starting Memo_v2 server...');
console.log('⚠️  Note: Server now runs from Memo_v2/src/server.ts');
console.log('💡 Use: npm start (runs Memo_v2/dist/server.js) or npm run dev');

// For now, just require the built server
// In production, use: node Memo_v2/dist/server.js
try {
  require('../Memo_v2/dist/server.js');
} catch (error) {
  console.error('❌ Failed to start server. Make sure Memo_v2 is built: npm run build');
  console.error('Error:', error);
  process.exit(1);
}
