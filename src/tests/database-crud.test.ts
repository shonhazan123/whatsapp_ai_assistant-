/**
 * Database CRUD Operations Test
 * 
 * Tests that all database operations actually write/read from Supabase
 * Run with: npm run test-db
 */

import { query } from '../config/database';
import { DatabaseToolset } from '../tools/DatabaseToolset';
import { logger } from '../utils/logger';

const TEST_USER_PHONE = '972999999999'; // Test user

async function cleanup() {
  logger.info('🧹 Cleaning up test data...');
  
  // Get user ID first (or skip if user doesn't exist)
  try {
    const userResult = await query(`SELECT get_or_create_user($1) as user_id`, [TEST_USER_PHONE]);
    if (userResult.rows.length > 0) {
      const userId = userResult.rows[0].user_id;
      
      // Delete test user's data (no list_items table - items are in lists.content jsonb)
      await query(`DELETE FROM tasks WHERE user_id = $1`, [userId]);
      await query(`DELETE FROM contact_list WHERE contact_list_id = $1`, [userId]);
      await query(`DELETE FROM lists WHERE list_id = $1`, [userId]);
      await query(`DELETE FROM conversation_history WHERE user_id = $1`, [userId]);
      await query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  } catch (error) {
    logger.warn('Cleanup warning (may be expected):', error instanceof Error ? error.message : error);
  }
  
  logger.info('✅ Cleanup complete');
}

async function testTaskCRUD() {
  logger.info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info('📝 Testing TASK CRUD Operations');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const toolset = new DatabaseToolset();
  
  // CREATE
  logger.info('1️⃣ Creating task...');
  const createResult = await toolset.execute('task.create', {
    userPhone: TEST_USER_PHONE,
    text: 'Test Task',
    priority: 'high'
  });
  
  if (!createResult.success) {
    throw new Error(`❌ Task creation failed: ${createResult.error}`);
  }
  
  // TaskService returns result directly in data
  const taskId = createResult.data.id;
  logger.info(`✅ Task created with ID: ${taskId}`);
  
  // READ
  logger.info('2️⃣ Reading task from database...');
  const dbResult = await query(
    `SELECT * FROM tasks WHERE id = $1`,
    [taskId]
  );
  
  if (dbResult.rows.length === 0) {
    throw new Error('❌ Task not found in database!');
  }
  
  logger.info(`✅ Task found in database: ${dbResult.rows[0].text}`);
  
  // GET ALL
  logger.info('3️⃣ Getting all tasks...');
  const getAllResult = await toolset.execute('task.getAll', {
    userPhone: TEST_USER_PHONE
  });
  
  if (!getAllResult.success || getAllResult.data.tasks.length === 0) {
    throw new Error('❌ Failed to get tasks');
  }
  
  logger.info(`✅ Found ${getAllResult.data.tasks.length} task(s)`);
  
  // UPDATE
  logger.info('4️⃣ Updating task...');
  const updateResult = await toolset.execute('task.update', {
    userPhone: TEST_USER_PHONE,
    id: taskId,
    data: { text: 'Updated Task' }
  });
  
  if (!updateResult.success) {
    throw new Error(`❌ Task update failed: ${updateResult.error}`);
  }
  
  logger.info('✅ Task updated');
  
  // DELETE
  logger.info('5️⃣ Deleting task...');
  const deleteResult = await toolset.execute('task.delete', {
    userPhone: TEST_USER_PHONE,
    id: taskId
  });
  
  if (!deleteResult.success) {
    throw new Error(`❌ Task deletion failed: ${deleteResult.error}`);
  }
  
  logger.info('✅ Task deleted');
  
  logger.info('✅ TASK CRUD TEST PASSED\n');
}

async function testListCRUD() {
  logger.info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info('📋 Testing LIST CRUD Operations');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const toolset = new DatabaseToolset();
  
  // CREATE LIST with items
  logger.info('1️⃣ Creating list with items...');
  const createResult = await toolset.execute('list.create', {
    userPhone: TEST_USER_PHONE,
    title: 'Test Shopping List',
    items: ['Milk', 'Bread', 'Eggs'],
    listType: 'checklist'
  });
  
  if (!createResult.success) {
    throw new Error(`❌ List creation failed: ${createResult.error}`);
  }
  
  // ListService returns result directly in data
  const listId = createResult.data.id;
  logger.info(`✅ List created with ID: ${listId}`);
  
  // READ from database
  logger.info('2️⃣ Reading list from database...');
  const dbListResult = await query(
    `SELECT * FROM lists WHERE id = $1`,
    [listId]
  );
  
  if (dbListResult.rows.length === 0) {
    throw new Error('❌ List not found in database!');
  }
  
  logger.info(`✅ List found in database: ${dbListResult.rows[0].list_name}`);
  
  // Check items (stored in content jsonb field)
  logger.info('3️⃣ Checking list items in database...');
  const dbListAfter = await query(
    `SELECT * FROM lists WHERE id = $1`,
    [listId]
  );
  
  const content = typeof dbListAfter.rows[0].content === 'string' 
    ? JSON.parse(dbListAfter.rows[0].content) 
    : dbListAfter.rows[0].content;
  
  if (content.items.length !== 3) {
    throw new Error(`❌ Expected 3 items, found ${content.items.length}`);
  }
  
  logger.info(`✅ Found ${content.items.length} items in database`);
  content.items.forEach((item: any, idx: number) => {
    logger.info(`   ${idx + 1}. ${item.text} (checked: ${item.checked})`);
  });
  
  // GET ALL
  logger.info('4️⃣ Getting all lists...');
  const getAllResult = await toolset.execute('list.getAll', {
    userPhone: TEST_USER_PHONE
  });
  
  if (!getAllResult.success || getAllResult.data.lists.length === 0) {
    throw new Error('❌ Failed to get lists');
  }
  
  logger.info(`✅ Found ${getAllResult.data.lists.length} list(s)`);
  
  // ADD ITEM
  logger.info('5️⃣ Adding item to list...');
  const addItemResult = await toolset.execute('list.addItem', {
    userPhone: TEST_USER_PHONE,
    listId: listId,
    text: 'Cheese'
  });
  
  if (!addItemResult.success) {
    throw new Error(`❌ Add item failed: ${addItemResult.error}`);
  }
  
  logger.info('✅ Item added');
  
  // Verify item was added (check content jsonb)
  const dbListAfterAdd = await query(
    `SELECT * FROM lists WHERE id = $1`,
    [listId]
  );
  
  const contentAfterAdd = typeof dbListAfterAdd.rows[0].content === 'string' 
    ? JSON.parse(dbListAfterAdd.rows[0].content) 
    : dbListAfterAdd.rows[0].content;
  
  if (contentAfterAdd.items.length !== 4) {
    throw new Error(`❌ Expected 4 items after add, found ${contentAfterAdd.items.length}`);
  }
  
  logger.info('✅ Verified item was added to database');
  
  // DELETE LIST
  logger.info('6️⃣ Deleting list...');
  const deleteResult = await toolset.execute('list.delete', {
    userPhone: TEST_USER_PHONE,
    id: listId
  });
  
  if (!deleteResult.success) {
    throw new Error(`❌ List deletion failed: ${deleteResult.error}`);
  }
  
  logger.info('✅ List deleted');
  
  logger.info('✅ LIST CRUD TEST PASSED\n');
}

async function testContactCRUD() {
  logger.info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info('👥 Testing CONTACT CRUD Operations');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const toolset = new DatabaseToolset();
  
  // CREATE
  logger.info('1️⃣ Creating contact...');
  const createResult = await toolset.execute('contact.create', {
    userPhone: TEST_USER_PHONE,
    name: 'John Doe',
    email: 'john@example.com',
    phone_number: '972501234567'
  });
  
  if (!createResult.success) {
    throw new Error(`❌ Contact creation failed: ${createResult.error}`);
  }
  
  // ContactService returns result directly in data
  const contactId = createResult.data.id;
  logger.info(`✅ Contact created with ID: ${contactId}`);
  
  // READ from database
  logger.info('2️⃣ Reading contact from database...');
  const dbResult = await query(
    `SELECT * FROM contact_list WHERE id = $1`,
    [contactId]
  );
  
  if (dbResult.rows.length === 0) {
    throw new Error('❌ Contact not found in database!');
  }
  
  logger.info(`✅ Contact found in database: ${dbResult.rows[0].name}`);
  
  // GET ALL
  logger.info('3️⃣ Getting all contacts...');
  const getAllResult = await toolset.execute('contact.getAll', {
    userPhone: TEST_USER_PHONE
  });
  
  if (!getAllResult.success || getAllResult.data.contacts.length === 0) {
    throw new Error('❌ Failed to get contacts');
  }
  
  logger.info(`✅ Found ${getAllResult.data.contacts.length} contact(s)`);
  
  // DELETE
  logger.info('4️⃣ Deleting contact...');
  const deleteResult = await toolset.execute('contact.delete', {
    userPhone: TEST_USER_PHONE,
    id: contactId
  });
  
  if (!deleteResult.success) {
    throw new Error(`❌ Contact deletion failed: ${deleteResult.error}`);
  }
  
  logger.info('✅ Contact deleted');
  
  logger.info('✅ CONTACT CRUD TEST PASSED\n');
}

async function runTests() {
  logger.info('🧪 Starting Database CRUD Tests...\n');
  
  try {
    // Cleanup before tests
    await cleanup();
    
    // Run tests
    await testTaskCRUD();
    await testListCRUD();
    await testContactCRUD();
    
    // Cleanup after tests
    await cleanup();
    
    logger.info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('✅ ALL DATABASE CRUD TESTS PASSED');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    process.exit(0);
  } catch (error) {
    logger.error('\n❌ TEST FAILED:', error);
    await cleanup();
    process.exit(1);
  }
}

runTests();

