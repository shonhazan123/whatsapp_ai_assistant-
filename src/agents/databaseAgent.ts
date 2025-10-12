import { openai } from '../config/openai';
import { query } from '../config/database';
import { logger } from '../utils/logger';

const DATABASE_SYSTEM_PROMPT = `YOU ARE A DATABASE-INTEGRATED AGENT WHO SERVES AS THE USER'S PERSONAL INFORMATION MANAGER. YOUR CORE FUNCTION IS TO INTERPRET NATURAL LANGUAGE COMMANDS AND TRANSLATE THEM INTO VALID SQL OPERATIONS USING POSTGRESQL.

## DATABASE STRUCTURE:
- USERS: users.id (UUID), users.phone
- TASKS: tasks.id, tasks.user_id → users.id, tasks.text, tasks.category, tasks.due_date, tasks.completed
- SUBTASKS: subtasks.id, subtasks.task_id → tasks.id, subtasks.text, subtasks.completed
- CONTACTS: contact_list.id, contact_list.contact_list_id → users.id, contact_list.name, contact_list.phone_number, contact_list.email
- LISTS: lists.id, lists.list_id → users.id, lists.list_name ('note' or 'checklist'), lists.content (JSONB)

## SUPPORTED INTENTS:

1. ADD TASK - phrases: "הוסף משימה", "תזכיר לי", "משימה חדשה"
2. ADD SUBTASK - phrases: "הוסף תת משימה", "סעיף חדש"
3. ADD CONTACT - phrases: "הוסף איש קשר", "צור רשימת אנשי קשר"
4. CREATE LIST - phrases: "רשימת בדיקה", "צור פתק"
5. GET TASKS - phrases: "מה המשימות שלי", "הצג משימות"
6. COMPLETE TASK - phrases: "סיימתי משימה", "סמן כהושלם"

## AVAILABLE FUNCTIONS:

1. addTask - Add new task
2. addSubtask - Add subtask to existing task
3. getTasks - Get user's tasks
4. completeTask - Mark task as complete
5. addContact - Add new contact
6. createList - Create note or checklist

User timezone: Asia/Jerusalem
Current time: {{NOW}}`;

export async function handleDatabaseRequest(
  message: string,
  userPhone: string
): Promise<string> {
  try {
    // Ensure user exists in database
    const userResult = await query(
      'SELECT create_user_if_not_exists($1) as user_id',
      [userPhone]
    );
    const userId = userResult.rows[0].user_id;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: DATABASE_SYSTEM_PROMPT.replace('{{NOW}}', new Date().toISOString())
        },
        {
          role: 'user',
          content: `User ID: ${userId}\nPhone: ${userPhone}\nRequest: ${message}`
        }
      ],
      functions: [
        {
          name: 'addTask',
          description: 'Add a new task for the user',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Task description' },
              category: { type: 'string', description: 'Task category' },
              dueDate: { type: 'string', description: 'Due date in ISO format' }
            },
            required: ['text']
          }
        },
        {
          name: 'addSubtask',
          description: 'Add a subtask to an existing task',
          parameters: {
            type: 'object',
            properties: {
              taskName: { type: 'string', description: 'Name of parent task' },
              text: { type: 'string', description: 'Subtask description' }
            },
            required: ['taskName', 'text']
          }
        },
        {
          name: 'getTasks',
          description: 'Get user tasks',
          parameters: {
            type: 'object',
            properties: {
              completed: { type: 'boolean', description: 'Filter by completion status' },
              category: { type: 'string', description: 'Filter by category' }
            }
          }
        },
        {
          name: 'completeTask',
          description: 'Mark task as completed',
          parameters: {
            type: 'object',
            properties: {
              taskName: { type: 'string', description: 'Name of task to complete' }
            },
            required: ['taskName']
          }
        },
        {
          name: 'addContact',
          description: 'Add a new contact',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Contact name' },
              phone: { type: 'string', description: 'Phone number' },
              email: { type: 'string', description: 'Email address' },
              address: { type: 'string', description: 'Physical address' }
            },
            required: ['name']
          }
        },
        {
          name: 'createList',
          description: 'Create a note or checklist',
          parameters: {
            type: 'object',
            properties: {
              listType: { type: 'string', enum: ['note', 'checklist'], description: 'Type of list' },
              content: { type: 'object', description: 'List content as JSON' }
            },
            required: ['listType', 'content']
          }
        }
      ],
      function_call: 'auto'
    });

    const responseMessage = completion.choices[0]?.message;

    if (responseMessage?.function_call) {
      const functionCall = responseMessage.function_call;
      const args = JSON.parse(functionCall.arguments);

      let result: any;
      switch (functionCall.name) {
        case 'addTask':
          result = await addTask(userId, args);
          break;
        case 'addSubtask':
          result = await addSubtask(userId, args);
          break;
        case 'getTasks':
          result = await getTasks(userId, args);
          break;
        case 'completeTask':
          result = await completeTask(userId, args);
          break;
        case 'addContact':
          result = await addContact(userId, args);
          break;
        case 'createList':
          result = await createList(userId, args);
          break;
        default:
          result = { error: 'Unknown function' };
      }

      // Get final response
      const finalCompletion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: DATABASE_SYSTEM_PROMPT.replace('{{NOW}}', new Date().toISOString())
          },
          {
            role: 'user',
            content: message
          },
          responseMessage,
          {
            role: 'function',
            name: functionCall.name,
            content: JSON.stringify(result)
          }
        ]
      });

      return finalCompletion.choices[0]?.message?.content || 'Database operation completed.';
    }

    return responseMessage?.content || 'Unable to process database request.';
  } catch (error) {
    logger.error('Database agent error:', error);
    return 'Sorry, I encountered an error with your database request.';
  }
}

async function addTask(userId: string, params: any) {
  try {
    const result = await query(
      `INSERT INTO tasks (user_id, text, category, due_date) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, text, category, due_date`,
      [userId, params.text, params.category || null, params.dueDate || null]
    );

    return { 
      success: true, 
      message: 'Task added successfully',
      task: result.rows[0]
    };
  } catch (error) {
    logger.error('Error adding task:', error);
    return { success: false, error: 'Failed to add task' };
  }
}

async function addSubtask(userId: string, params: any) {
  try {
    // Find parent task
    const taskResult = await query(
      `SELECT id FROM tasks 
       WHERE user_id = $1 AND text ILIKE $2 
       ORDER BY created_at DESC LIMIT 1`,
      [userId, `%${params.taskName}%`]
    );

    if (taskResult.rows.length === 0) {
      return { success: false, error: 'Parent task not found' };
    }

    const taskId = taskResult.rows[0].id;

    const result = await query(
      `INSERT INTO subtasks (task_id, text) 
       VALUES ($1, $2) 
       RETURNING id, text`,
      [taskId, params.text]
    );

    return {
      success: true,
      message: 'Subtask added successfully',
      subtask: result.rows[0]
    };
  } catch (error) {
    logger.error('Error adding subtask:', error);
    return { success: false, error: 'Failed to add subtask' };
  }
}

async function getTasks(userId: string, params: any) {
  try {
    let queryText = `
      SELECT t.id, t.text, t.category, t.due_date, t.completed,
             COALESCE(
               json_agg(
                 json_build_object('id', s.id, 'text', s.text, 'completed', s.completed)
               ) FILTER (WHERE s.id IS NOT NULL),
               '[]'
             ) as subtasks
      FROM tasks t
      LEFT JOIN subtasks s ON s.task_id = t.id
      WHERE t.user_id = $1
    `;

    const queryParams: any[] = [userId];
    let paramCount = 1;

    if (params.completed !== undefined) {
      paramCount++;
      queryText += ` AND t.completed = $${paramCount}`;
      queryParams.push(params.completed);
    }

    if (params.category) {
      paramCount++;
      queryText += ` AND t.category = $${paramCount}`;
      queryParams.push(params.category);
    }

    queryText += ` GROUP BY t.id ORDER BY t.created_at DESC`;

    const result = await query(queryText, queryParams);

    return {
      success: true,
      tasks: result.rows
    };
  } catch (error) {
    logger.error('Error getting tasks:', error);
    return { success: false, error: 'Failed to get tasks' };
  }
}

async function completeTask(userId: string, params: any) {
  try {
    const result = await query(
      `UPDATE tasks 
       SET completed = true, updated_at = NOW() 
       WHERE user_id = $1 AND text ILIKE $2 
       RETURNING id, text`,
      [userId, `%${params.taskName}%`]
    );

    if (result.rows.length === 0) {
      return { success: false, error: 'Task not found' };
    }

    return {
      success: true,
      message: 'Task marked as completed',
      task: result.rows[0]
    };
  } catch (error) {
    logger.error('Error completing task:', error);
    return { success: false, error: 'Failed to complete task' };
  }
}

async function addContact(userId: string, params: any) {
  try {
    const result = await query(
      `INSERT INTO contact_list (contact_list_id, name, phone_number, email, address) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, name, phone_number, email`,
      [userId, params.name, params.phone || null, params.email || null, params.address || null]
    );

    return {
      success: true,
      message: 'Contact added successfully',
      contact: result.rows[0]
    };
  } catch (error) {
    logger.error('Error adding contact:', error);
    return { success: false, error: 'Failed to add contact' };
  }
}

async function createList(userId: string, params: any) {
  try {
    const result = await query(
      `INSERT INTO lists (list_id, list_name, content) 
       VALUES ($1, $2, $3) 
       RETURNING id, list_name, content`,
      [userId, params.listType, JSON.stringify(params.content)]
    );

    return {
      success: true,
      message: 'List created successfully',
      list: result.rows[0]
    };
  } catch (error) {
    logger.error('Error creating list:', error);
    return { success: false, error: 'Failed to create list' };
  }
}