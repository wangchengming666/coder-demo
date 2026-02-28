/**
 * Integration tests — real BSC node calls
 * Run with: npm run test:integration
 */

const request = require('supertest');
const { app } = require('../src/index');

const KNOWN_TX = '0xc108046eac2a767834dfba4a20e436efd57977d374e9f77a6298d84e0e674072';
const ZERO_TX  = '0x' + '0'.repeat(64);
const DATETIME_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

describe('Integration: real BSC node', () => {
  test('known SUCCESS tx has correct fields', async () => {
    const res = await request(app).get(`/api/v1/tx/${KNOWN_TX}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);
    const data = res.body.data;
    expect(data.status).toBe('SUCCESS');
    expect(data.datetime).toMatch(DATETIME_REGEX);
    expect(data).toHaveProperty('from');
    expect(data).toHaveProperty('to');
    expect(data).toHaveProperty('value');
  }, 30000);

  test('non-existent tx hash → code 404', async () => {
    const res = await request(app).get(`/api/v1/tx/${ZERO_TX}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(404);
  }, 30000);
});
