import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteIdent as pgQuoteIdent } from "../browser/postgres.js";
import { quoteIdent as mysqlQuoteIdent } from "../browser/mysql.js";
import { quoteIdent as clickhouseQuoteIdent } from "../browser/clickhouse.js";
import { tokenize } from "../browser/redis.js";

// The identifier quoters are what stand between a table/collection name a
// user clicks in the UI and a raw SQL string — this is the actual injection
// boundary for browseObject(), so it's worth pinning down directly rather
// than only indirectly through a live-database integration test.
const INJECTION_ATTEMPTS = [
  `users"; DROP TABLE users; --`,
  `users\`; DROP TABLE users; --`,
  `users; DROP TABLE users;`,
  `users" OR "1"="1`,
  `users/*`,
  `../../etc/passwd`,
  ``,
  `   `,
  `users table`,
];

test("postgres quoteIdent accepts a plain identifier and wraps it", () => {
  assert.equal(pgQuoteIdent("users"), `"users"`);
  assert.equal(pgQuoteIdent("_private_table"), `"_private_table"`);
  assert.equal(pgQuoteIdent("table1"), `"table1"`);
});

test("postgres quoteIdent rejects anything that isn't a plain identifier", () => {
  for (const attempt of INJECTION_ATTEMPTS) {
    assert.throws(() => pgQuoteIdent(attempt), `should reject: ${JSON.stringify(attempt)}`);
  }
});

test("mysql quoteIdent accepts a plain identifier and backtick-wraps it", () => {
  assert.equal(mysqlQuoteIdent("users"), "`users`");
});

test("mysql quoteIdent rejects anything that isn't a plain identifier", () => {
  for (const attempt of INJECTION_ATTEMPTS) {
    assert.throws(() => mysqlQuoteIdent(attempt), `should reject: ${JSON.stringify(attempt)}`);
  }
});

test("clickhouse quoteIdent accepts a plain identifier and backtick-wraps it", () => {
  assert.equal(clickhouseQuoteIdent("events"), "`events`");
});

test("clickhouse quoteIdent rejects anything that isn't a plain identifier", () => {
  for (const attempt of INJECTION_ATTEMPTS) {
    assert.throws(() => clickhouseQuoteIdent(attempt), `should reject: ${JSON.stringify(attempt)}`);
  }
});

test("redis command tokenizer splits on whitespace", () => {
  assert.deepEqual(tokenize("GET my_key"), ["GET", "my_key"]);
  assert.deepEqual(tokenize("HGETALL  user:1"), ["HGETALL", "user:1"]);
});

test("redis command tokenizer respects quoted segments containing spaces", () => {
  assert.deepEqual(tokenize(`SET greeting "hello world"`), ["SET", "greeting", "hello world"]);
  assert.deepEqual(tokenize(`SET name 'jane doe'`), ["SET", "name", "jane doe"]);
});

test("redis command tokenizer on an empty string yields no tokens", () => {
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize("   "), []);
});
