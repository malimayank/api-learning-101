const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { z } = require('zod'); // Step 1: Import Zod for future validations

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== STEP 2: REUSABLE RESPONSE HELPERS ====================
// Reusable helper function to send standardized success responses.
// Why it matters in production: Reduces boilerplate, keeps code DRY, and guarantees that 
// every successful API response has the exact same foundation (success: true).
const sendSuccess = (res, statusCode, data = null, extra = {}) => {
  return res.status(statusCode).json({
    success: true,
    ...extra,
    ...(data !== null && { data })
  });
};

// Reusable helper function to send standardized error responses.
// Why it matters in production: Enforces consistent error format across the application. 
// Standardized keys (success: false, error, message) make it easier for clients to display 
// structured error dialogs/validations.
const sendError = (res, statusCode, error, message, extra = {}) => {
  return res.status(statusCode).json({
    success: false,
    error,
    message,
    ...extra
  });
};

// ==================== STEP 3: ZOD SCHEMAS & VALIDATION MIDDLEWARE ====================

// A. Zod Schemas with Custom Error Messages
// Why custom error messages matter: Provides clear, user-friendly instructions to frontend/clients.
const createUserSchema = z.object({
  name: z
    .string({ required_error: 'Name is required' })
    .trim()
    .min(2, 'Name must be at least 2 characters long')
    .max(50, 'Name must be under 50 characters'),
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .email('Invalid email format'),
  age: z
    .number()
    .int('Age must be an integer')
    .min(0, 'Age must be a positive number')
    .max(150, 'Age cannot exceed 150')
    .optional()
});

// For PUT (Full Update) - Same fields are required as Creation
const updateUserSchema = createUserSchema;

// For PATCH (Partial Update) - All fields optional, but body cannot be empty
const patchUserSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters long')
    .max(50, 'Name must be under 50 characters')
    .optional(),
  email: z
    .string()
    .trim()
    .email('Invalid email format')
    .optional(),
  age: z
    .number()
    .int('Age must be an integer')
    .min(0, 'Age must be a positive number')
    .max(150, 'Age cannot exceed 150')
    .optional()
}).refine((data) => {
  // Ensure that at least one of the fields is provided
  return data.name !== undefined || data.email !== undefined || data.age !== undefined;
}, {
  message: 'At least one field (name, email, or age) must be provided for update',
  path: [] // Top-level object error
});

// B. Reusable Validation Middleware
// Why middleware architecture is scalable: It allows us to intercept the request body, 
// validate it automatically, and return validation errors before they ever hit our route controllers.
// This keeps route code completely free of validation checks.
const validateRequest = (schema) => {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    
    if (!result.success) {
      // Format Zod errors to be extremely readable
      const errorDetails = result.error.errors.map((err) => ({
        field: err.path.join('.') || 'body',
        message: err.message
      }));
      
      // Use our sendError helper to send standard 422 Validation Error responses
      return sendError(res, 422, 'Validation Error', 'Input validation failed', {
        details: errorDetails
      });
    }
    
    // Replace req.body with the parsed/cleaned data (Zod trims strings automatically)
    req.body = result.data;
    next();
  };
};

// Middleware
app.use(cors());
app.use(express.json());

// Path to JSON file
const DATA_FILE = path.join(__dirname, '..', 'data', 'users.json');

// In-memory storage (Vercel serverless functions have read-only filesystem)
let usersCache = null;

// Helper function to read users (loads from file once, then uses cache)
const readUsers = () => {
  try {
    // Load from file only if cache is empty (first time or after reset)
    if (usersCache === null) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      usersCache = JSON.parse(data);
      console.log('Users loaded from file into memory');
    }
    return usersCache;
  } catch (error) {
    console.error('Error reading users:', error);
    // If file read fails, initialize with default data
    usersCache = [
      { id: 1, name: 'John Doe', email: 'john@example.com', age: 30, createdAt: new Date().toISOString() },
      { id: 2, name: 'Jane Smith', email: 'jane@example.com', age: 25, createdAt: new Date().toISOString() }
    ];
    return usersCache;
  }
};

// Helper function to write users (updates in-memory cache only)
const writeUsers = (users) => {
  try {
    // Store in memory cache (no file write on Vercel)
    usersCache = users;
    console.log('Users updated in memory cache');
    return true;
  } catch (error) {
    console.error('Error updating users cache:', error);
    return false;
  }
};

// Helper function to generate next ID
const getNextId = (users) => {
  if (users.length === 0) return 1;
  return Math.max(...users.map(u => u.id)) + 1;
};

// ==================== ROUTES ====================

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to API Learning 101! 🚀',
    version: '1.0.0',
    storage: 'In-memory (data persists during serverless function lifetime)',
    note: 'Changes are temporary and reset periodically. Use GET /api/reset to reload initial data.',
    endpoints: {
      users: {
        'GET /api/users': 'Get all users',
        'GET /api/users/:id': 'Get user by ID',
        'POST /api/users': 'Create new user',
        'PUT /api/users/:id': 'Update user (full)',
        'PATCH /api/users/:id': 'Update user (partial)',
        'DELETE /api/users/:id': 'Delete user',
        'GET /api/reset': 'Reset data to initial state'
      }
    },
    documentation: 'https://github.com/nisalgunawardhana/api-learning-101',
    author: 'Nisal Gunawardhana'
  });
});

// GET /api/users - Get all users
app.get('/api/users', (req, res) => {
  try {
    const users = readUsers();
    return sendSuccess(res, 200, users, { count: users.length });
  } catch (error) {
    console.error('Error retrieving users:', error);
    return sendError(res, 500, 'Internal Server Error', 'Failed to retrieve users');
  }
});

// GET /api/users/:id - Get user by ID
app.get('/api/users/:id', (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    
    // Safely check if parameter is not a valid number
    if (isNaN(userId)) {
      return sendError(res, 400, 'Bad Request', 'User ID must be a valid number');
    }
    
    const users = readUsers();
    const user = users.find(u => u.id === userId);
    
    if (!user) {
      return sendError(res, 404, 'Not Found', `User with ID ${userId} not found`);
    }
    
    return sendSuccess(res, 200, user);
  } catch (error) {
    console.error('Error retrieving user:', error);
    return sendError(res, 500, 'Internal Server Error', 'Failed to retrieve user');
  }
});

// POST /api/users - Create new user with schema validation middleware
app.post('/api/users', validateRequest(createUserSchema), (req, res) => {
  try {
    const { name, email, age } = req.body;
    const users = readUsers();
    
    // Check for duplicate email (normalize check case-insensitively)
    const existingUser = users.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (existingUser) {
      return sendError(res, 409, 'Conflict', 'User with this email already exists', { field: 'email' });
    }
    
    // Create new user (inputs are already trimmed by Zod schema)
    const newUser = {
      id: getNextId(users),
      name,
      email,
      ...(age !== undefined && { age }),
      createdAt: new Date().toISOString()
    };
    
    users.push(newUser);
    
    // Write changes in memory cache
    if (!writeUsers(users)) {
      return sendError(res, 500, 'Internal Server Error', 'Failed to save user');
    }
    
    return sendSuccess(res, 201, newUser, { message: 'User created successfully' });
  } catch (error) {
    console.error('Error creating user:', error);
    return sendError(res, 500, 'Internal Server Error', 'Failed to create user');
  }
});

// PUT /api/users/:id - Update user (full update) with schema validation middleware
app.put('/api/users/:id', validateRequest(updateUserSchema), (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    
    // Safely check if parameter is not a valid number
    if (isNaN(userId)) {
      return sendError(res, 400, 'Bad Request', 'User ID must be a valid number');
    }
    
    const { name, email, age } = req.body;
    const users = readUsers();
    const userIndex = users.findIndex(u => u.id === userId);
    
    if (userIndex === -1) {
      return sendError(res, 404, 'Not Found', `User with ID ${userId} not found`);
    }
    
    // Check for duplicate email (excluding current user)
    const existingUser = users.find(u => 
      u.email.toLowerCase() === email.toLowerCase() && u.id !== userId
    );
    if (existingUser) {
      return sendError(res, 409, 'Conflict', 'Another user with this email already exists', { field: 'email' });
    }
    
    // Update user (keep original createdAt, inputs already sanitized by Zod)
    const updatedUser = {
      id: userId,
      name,
      email,
      ...(age !== undefined && { age }),
      createdAt: users[userIndex].createdAt,
      updatedAt: new Date().toISOString()
    };
    
    users[userIndex] = updatedUser;
    
    // Write changes in memory cache
    if (!writeUsers(users)) {
      return sendError(res, 500, 'Internal Server Error', 'Failed to update user');
    }
    
    return sendSuccess(res, 200, updatedUser, { message: 'User updated successfully' });
  } catch (error) {
    console.error('Error updating user:', error);
    return sendError(res, 500, 'Internal Server Error', 'Failed to update user');
  }
});

// PATCH /api/users/:id - Partial update user with schema validation middleware
app.patch('/api/users/:id', validateRequest(patchUserSchema), (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    
    // Safely check if parameter is not a valid number
    if (isNaN(userId)) {
      return sendError(res, 400, 'Bad Request', 'User ID must be a valid number');
    }
    
    const users = readUsers();
    const userIndex = users.findIndex(u => u.id === userId);
    
    if (userIndex === -1) {
      return sendError(res, 404, 'Not Found', `User with ID ${userId} not found`);
    }
    
    // If email is being updated, check for duplicates (excluding current user)
    if (req.body.email) {
      const emailToCheck = req.body.email.toLowerCase();
      const duplicateUser = users.find(u => 
        u.email.toLowerCase() === emailToCheck && u.id !== userId
      );
      if (duplicateUser) {
        return sendError(res, 409, 'Conflict', 'Another user with this email already exists', { field: 'email' });
      }
    }
    
    // Merge updates safely
    const originalUser = users[userIndex];
    const updatedUser = {
      ...originalUser,
      ...req.body,
      id: userId, // Lock ID integrity
      createdAt: originalUser.createdAt, // Lock original timestamp
      updatedAt: new Date().toISOString()
    };
    
    users[userIndex] = updatedUser;
    
    // Save updated users back to memory cache
    if (!writeUsers(users)) {
      return sendError(res, 500, 'Internal Server Error', 'Failed to update user');
    }
    
    return sendSuccess(res, 200, updatedUser, { message: 'User partially updated successfully' });
  } catch (error) {
    console.error('Error partially updating user:', error);
    return sendError(res, 500, 'Internal Server Error', 'Failed to update user');
  }
});

// DELETE /api/users/:id - Delete user
app.delete('/api/users/:id', (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    
    // Safely check if parameter is not a valid number
    if (isNaN(userId)) {
      return sendError(res, 400, 'Bad Request', 'User ID must be a valid number');
    }
    
    const users = readUsers();
    const userIndex = users.findIndex(u => u.id === userId);
    
    if (userIndex === -1) {
      return sendError(res, 404, 'Not Found', `User with ID ${userId} not found`);
    }
    
    const deletedUser = users[userIndex];
    users.splice(userIndex, 1);
    
    // Write changes in memory cache
    if (!writeUsers(users)) {
      return sendError(res, 500, 'Internal Server Error', 'Failed to delete user');
    }
    
    return sendSuccess(res, 200, {
      id: userId,
      name: deletedUser.name,
      email: deletedUser.email
    }, { message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    return sendError(res, 500, 'Internal Server Error', 'Failed to delete user');
  }
});

// GET /api/reset - Reset data to initial state (for testing)
app.get('/api/reset', (req, res) => {
  try {
    // Reset cache to null, forcing reload from file on next read
    usersCache = null;
    const users = readUsers();
    
    return sendSuccess(res, 200, users, { 
      message: 'Data reset to initial state',
      count: users.length
    });
  } catch (error) {
    console.error('Error resetting data:', error);
    return sendError(res, 500, 'Internal Server Error', 'Failed to reset data');
  }
});

// 404 handler for undefined routes
app.use((req, res) => {
  return sendError(res, 404, 'Not Found', `Route ${req.method} ${req.url} not found`, {
    availableEndpoints: [
      'GET /',
      'GET /api/users',
      'GET /api/users/:id',
      'POST /api/users',
      'PUT /api/users/:id',
      'PATCH /api/users/:id',
      'DELETE /api/users/:id',
      'GET /api/reset'
    ]
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  return sendError(res, 500, 'Internal Server Error', 'An unexpected error occurred');
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 API Learning 101 server running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`📚 Documentation: https://github.com/nisalgunawardhana/api-learning-101`);
});

// Export for Vercel serverless function
module.exports = app;
