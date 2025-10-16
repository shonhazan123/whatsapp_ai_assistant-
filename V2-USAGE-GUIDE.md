# 🚀 V2 Architecture Usage Guide

## Quick Start

### Basic Usage
```javascript
const { processMessageV2 } = require('./dist/src/index-v2');

// Process a message (same as before)
const response = await processMessageV2('+972501234567', 'אילו רשימות יש לי כרגע?');
console.log(response); // Hebrew response with user's lists
```

### Advanced Usage - Direct Service Access
```javascript
const { ServiceContainer } = require('./dist/src/index-v2');

const container = ServiceContainer.getInstance();
const taskService = container.getTaskService();

// Create a task
const result = await taskService.create({
  userPhone: '+972501234567',
  data: {
    text: 'Complete project proposal',
    category: 'work',
    dueDate: '2024-01-15T10:00:00Z'
  }
});
```

## Available Services

### TaskService
```javascript
const taskService = container.getTaskService();

// CRUD operations
await taskService.create({ userPhone, data: taskData });
await taskService.getById({ userPhone, id: taskId });
await taskService.getAll({ userPhone, filters, limit, offset });
await taskService.update({ userPhone, id: taskId, data: updateData });
await taskService.delete({ userPhone, id: taskId });

// Bulk operations
await taskService.createMultiple({ userPhone, items: taskArray });

// Special operations
await taskService.complete({ userPhone, id: taskId, data: {} });
await taskService.addSubtask({ userPhone, data: { taskId, text } });
```

### ContactService
```javascript
const contactService = container.getContactService();

// CRUD operations
await contactService.create({ userPhone, data: contactData });
await contactService.getById({ userPhone, id: contactId });
await contactService.getAll({ userPhone, filters, limit, offset });
await contactService.update({ userPhone, id: contactId, data: updateData });
await contactService.delete({ userPhone, id: contactId });

// Search
await contactService.search({ userPhone, filters: { name: 'John' } });
```

### ListService
```javascript
const listService = container.getListService();

// CRUD operations
await listService.create({ userPhone, data: { listType: 'checklist', items: [...] } });
await listService.getById({ userPhone, id: listId });
await listService.getAll({ userPhone, filters, limit, offset });
await listService.update({ userPhone, id: listId, data: updateData });
await listService.delete({ userPhone, id: listId });

// List item operations
await listService.addItem({ userPhone, id: listId, data: { listId, itemText } });
await listService.toggleItem({ userPhone, id: listId, data: { listId, itemIndex } });
```

### CalendarService
```javascript
const calendarService = container.getCalendarService();

// Calendar operations
await calendarService.createEvent({ summary, start, end, attendees });
await calendarService.createMultipleEvents({ events: [...] });
await calendarService.getEvents({ timeMin, timeMax });
await calendarService.updateEvent({ eventId, summary, start, end });
await calendarService.deleteEvent(eventId);
```

### GmailService
```javascript
const gmailService = container.getGmailService();

// Email operations
await gmailService.sendEmail({ to, subject, body, cc, bcc });
await gmailService.getEmails({ query, maxResults });
await gmailService.getUnreadEmails(maxResults);
await gmailService.searchEmails(query, maxResults);
await gmailService.replyToEmail({ messageId, body });
await gmailService.markAsRead(messageId);
```

## Filtering Examples

### Task Filtering
```javascript
// Filter by completion status
const pendingTasks = await taskService.getAll({
  userPhone: '+972501234567',
  filters: { completed: false }
});

// Filter by category
const workTasks = await taskService.getAll({
  userPhone: '+972501234567',
  filters: { category: 'work' }
});

// Filter by date range
const recentTasks = await taskService.getAll({
  userPhone: '+972501234567',
  filters: {
    dueDateFrom: '2024-01-01',
    dueDateTo: '2024-12-31'
  }
});
```

### Contact Filtering
```javascript
// Search by name
const contacts = await contactService.search({
  userPhone: '+972501234567',
  filters: { name: 'John' }
});

// Filter by email
const emailContacts = await contactService.getAll({
  userPhone: '+972501234567',
  filters: { email: '@gmail.com' }
});
```

### List Filtering
```javascript
// Get only checklists
const checklists = await listService.getAll({
  userPhone: '+972501234567',
  filters: { listType: 'checklist' }
});

// Search by title
const shoppingLists = await listService.getAll({
  userPhone: '+972501234567',
  filters: { title: 'shopping' }
});
```

## Language Support

The V2 architecture automatically detects and responds in the user's language:

```javascript
// English input
const response1 = await processMessageV2('+972501234567', 'What tasks do I have?');
// Returns English response

// Hebrew input
const response2 = await processMessageV2('+972501234567', 'אילו משימות יש לי?');
// Returns Hebrew response
```

## Error Handling

All services return consistent response format:

```javascript
const result = await taskService.create({ userPhone, data: taskData });

if (result.success) {
  console.log('Success:', result.data);
  console.log('Message:', result.message);
} else {
  console.error('Error:', result.error);
}
```

## Performance Tips

1. **Use pagination** for large datasets:
```javascript
const tasks = await taskService.getAll({
  userPhone: '+972501234567',
  limit: 20,
  offset: 0
});
```

2. **Use bulk operations** for multiple items:
```javascript
await taskService.createMultiple({
  userPhone: '+972501234567',
  items: taskArray
});
```

3. **Use specific filters** to reduce data transfer:
```javascript
const recentTasks = await taskService.getAll({
  userPhone: '+972501234567',
  filters: { completed: false },
  limit: 10
});
```

## Migration from V1

Replace your existing imports:

```javascript
// Old V1
import { processMessage } from './src/agents/mainAgent';

// New V2
import { processMessageV2 } from './dist/src/index-v2';

// Usage remains the same
const response = await processMessageV2(userPhone, message);
```

The V2 architecture is fully backward compatible while providing much more functionality and better performance!
