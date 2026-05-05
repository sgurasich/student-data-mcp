#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, isInitializeRequest, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const API_URL = process.env.STUDENT_DATA_API_URL ?? 'https://youarethedata.thedataishere.net/api';
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4501;

function createMcpServer() {
  let credentials = null;
  let authToken = null;

  const server = new Server(
    { name: 'student-data', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  async function ensureCredentials() {
    if (credentials) return;

    let result;
    try {
      result = await server.elicitInput({
        mode: 'form',
        message: 'Enter your Student Data credentials.',
        requestedSchema: {
          type: 'object',
          properties: {
            username: { type: 'string', title: 'Username' },
            password: { type: 'string', title: 'Password', format: 'password' },
          },
          required: ['username', 'password'],
        },
      });
    } catch {
      throw new Error(
        'This client does not support asking for your username and password, so there is no way to log in. ' +
          'You must use a client that supports elicitation to use this app.'
      );
    }

    if (result.action !== 'accept' || !result.content) {
      throw new Error('Login cancelled.');
    }

    credentials = {
      username: result.content.username,
      password: result.content.password,
    };
  }

  async function authenticate() {
    await ensureCredentials();
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });
    if (!res.ok) {
      const text = await res.text();
      credentials = null; // Clear so the next call re-prompts
      throw new Error(`Login failed: ${text}`);
    }
    const data = await res.json();
    authToken = data.token;
  }

  async function api(path, options = {}) {
    if (!authToken) await authenticate();

    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
        ...options.headers,
      },
    });

    if (res.status === 401) {
      // Token expired — get a fresh one with the same credentials
      authToken = null;
      await authenticate();
      return api(path, options);
    }

    const text = await res.text();
    if (!res.ok) throw new Error(`API ${res.status}: ${text}`);

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_school_years',
        description: 'List all school years.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'list_classes',
        description: 'List all classes for a school year.',
        inputSchema: {
          type: 'object',
          properties: {
            school_year_id: { type: 'number', description: 'School year ID' },
          },
          required: ['school_year_id'],
        },
      },
      {
        name: 'get_class_students',
        description: 'List active students enrolled in a class.',
        inputSchema: {
          type: 'object',
          properties: {
            school_year_id: { type: 'number', description: 'School year ID' },
            class_id: { type: 'number', description: 'Class ID' },
          },
          required: ['school_year_id', 'class_id'],
        },
      },
      {
        name: 'list_students',
        description: 'List all students.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'get_student',
        description: 'Get a single student by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            student_id: { type: 'number', description: 'Student ID' },
          },
          required: ['student_id'],
        },
      },
      {
        name: 'create_student',
        description: 'Create a new student record.',
        inputSchema: {
          type: 'object',
          properties: {
            personal_name: { type: 'string', description: 'First/given name (required)' },
            family_name: { type: 'string', description: 'Last name' },
            middle_names: { type: 'string', description: 'Middle name(s)' },
            suffix: { type: 'string', description: 'Name suffix, e.g. Jr., III' },
          },
          required: ['personal_name'],
        },
      },
      {
        name: 'get_student_classes',
        description: 'List classes a student is assigned to.',
        inputSchema: {
          type: 'object',
          properties: {
            student_id: { type: 'number', description: 'Student ID' },
          },
          required: ['student_id'],
        },
      },
      {
        name: 'assign_student_to_class',
        description: 'Enroll a student in a class.',
        inputSchema: {
          type: 'object',
          properties: {
            student_id: { type: 'number', description: 'Student ID' },
            class_id: { type: 'number', description: 'Class ID' },
          },
          required: ['student_id', 'class_id'],
        },
      },
      {
        name: 'unassign_student_from_class',
        description: 'Remove a student from a class.',
        inputSchema: {
          type: 'object',
          properties: {
            student_id: { type: 'number', description: 'Student ID' },
            class_id: { type: 'number', description: 'Class ID' },
          },
          required: ['student_id', 'class_id'],
        },
      },
      {
        name: 'get_student_states',
        description:
          'Get attendance records for all students in a class on a given date. State values: 0=unset, 1=absent, 2=late, 3=present.',
        inputSchema: {
          type: 'object',
          properties: {
            class_id: { type: 'number', description: 'Class ID' },
            date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
          },
          required: ['class_id', 'date'],
        },
      },
      {
        name: 'set_student_state',
        description:
          "Set a student's attendance state for a class on a date. State values: 0=unset, 1=absent, 2=late, 3=present.",
        inputSchema: {
          type: 'object',
          properties: {
            student_id: { type: 'number', description: 'Student ID' },
            class_id: { type: 'number', description: 'Class ID' },
            date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
            state: {
              type: 'number',
              description: '0=unset, 1=absent, 2=late, 3=present',
              enum: [0, 1, 2, 3],
            },
          },
          required: ['student_id', 'class_id', 'date', 'state'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result;

      switch (name) {
        case 'list_school_years':
          result = await api('/school-years');
          break;

        case 'list_classes':
          result = await api(`/school-years/${args.school_year_id}/classes`);
          break;

        case 'get_class_students':
          result = await api(
            `/school-years/${args.school_year_id}/classes/${args.class_id}/students`
          );
          break;

        case 'list_students':
          result = await api('/students');
          break;

        case 'get_student':
          result = await api(`/students/${args.student_id}`);
          break;

        case 'create_student':
          result = await api('/students', {
            method: 'POST',
            body: JSON.stringify({
              personal_name: args.personal_name,
              family_name: args.family_name,
              middle_names: args.middle_names,
              suffix: args.suffix,
            }),
          });
          break;

        case 'get_student_classes':
          result = await api(`/students/${args.student_id}/classes`);
          break;

        case 'assign_student_to_class':
          result = await api(`/students/${args.student_id}/classes`, {
            method: 'POST',
            body: JSON.stringify({ classId: args.class_id }),
          });
          break;

        case 'unassign_student_from_class':
          result = await api(
            `/students/${args.student_id}/classes/${args.class_id}`,
            { method: 'DELETE' }
          );
          break;

        case 'get_student_states':
          result = await api(
            `/student-states?class_id=${args.class_id}&date=${encodeURIComponent(args.date)}`
          );
          break;

        case 'set_student_state':
          result = await api('/student-states', {
            method: 'POST',
            body: JSON.stringify({
              student_id: args.student_id,
              class_id: args.class_id,
              date: args.date,
              state: args.state,
            }),
          });
          break;

        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  });

  return server;
}

const app = express();
app.use(express.json());

const transports = {};

app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  try {
    let transport;
    if (sessionId && transports[sessionId]) {
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports[sid] = transport;
        },
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) delete transports[sid];
      };
      const server = createMcpServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
        id: null,
      });
      return;
    }
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('Error handling MCP request:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
});

app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await transports[sessionId].handleRequest(req, res);
});

app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  try {
    await transports[sessionId].handleRequest(req, res);
  } catch (err) {
    console.error('Error handling session termination:', err);
    if (!res.headersSent) res.status(500).send('Error processing session termination');
  }
});

app.listen(PORT, () => {
  console.log(`Student Data MCP server listening on port ${PORT}`);
});

process.on('SIGINT', async () => {
  for (const sid of Object.keys(transports)) {
    try {
      await transports[sid].close();
    } catch {}
    delete transports[sid];
  }
  process.exit(0);
});
