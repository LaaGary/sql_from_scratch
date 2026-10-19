import test from "node:test";
import assert from "node:assert/strict";
import {
  affinityOf, AFFINITY, typeOf, toNumber, toText, truthy,
  compareValues, compare, and3, or3, not3, applyAffinity, likeMatch,
  groupKey, displayValue,
} from "../src/values.js";

test("type names map to affinities", () => {
  assert.equal(affinityOf("INTEGER"), AFFINITY.INTEGER);
  assert.equal(affinityOf("int"), AFFINITY.INTEGER);
  assert.equal(affinityOf("DOUBLE"), AFFINITY.REAL);
  assert.equal(affinityOf("VARCHAR(20)"), AFFINITY.TEXT);
  assert.equal(affinityOf("BOOLEAN"), AFFINITY.BOOLEAN);
});

test("typeOf distinguishes integer, real, text, and NULL", () => {
  assert.equal(typeOf(1), "integer");
  assert.equal(typeOf(1.5), "real");
  assert.equal(typeOf("a"), "text");
  assert.equal(typeOf(null), "null");
  assert.equal(typeOf(true), "integer");
});

test("toNumber's best-effort conversion", () => {
  assert.equal(toNumber("42"), 42);
  assert.equal(toNumber(" 3.5 "), 3.5);
  assert.equal(toNumber("abc"), null);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(true), 1);
});

test("toText and truthiness", () => {
  assert.equal(toText(42), "42");
  assert.equal(toText(null), null);
  assert.equal(truthy(0), false);
  assert.equal(truthy("0"), false);
  assert.equal(truthy("false"), false);
  assert.equal(truthy("x"), true);
  assert.equal(truthy(null), false);
});

test("compareValues: NULL first, numbers before text", () => {
  assert.ok(compareValues(null, 1) < 0);
  assert.ok(compareValues(1, "a") < 0);
  assert.ok(compareValues(2, 10) < 0);
  assert.equal(compareValues(1, 1.0), 0);
  assert.equal(compareValues("abc", "abc"), 0);
});

test("compare: comparing with NULL returns null (UNKNOWN)", () => {
  assert.equal(compare("=", null, 1), null);
  assert.equal(compare(">", 1, null), null);
  assert.equal(compare("=", 1, 1), true);
  assert.equal(compare("!=", 1, 2), true);
  assert.equal(compare("=", 1, "1"), false); // different types are not equal
  assert.equal(compare("<", 1, "1"), true);  // but numbers sort before text
});

test("three-valued logic AND / OR / NOT", () => {
  assert.equal(and3(true, null), null);
  assert.equal(and3(false, null), false);
  assert.equal(or3(true, null), true);
  assert.equal(or3(false, null), null);
  assert.equal(not3(null), null);
  assert.equal(not3(true), false);
});

test("type affinity conversion", () => {
  assert.equal(applyAffinity("42", AFFINITY.INTEGER), 42);
  assert.equal(applyAffinity("3.9", AFFINITY.INTEGER), 3);
  assert.equal(applyAffinity("3.5", AFFINITY.REAL), 3.5);
  assert.equal(applyAffinity(42, AFFINITY.TEXT), "42");
  assert.equal(applyAffinity("true", AFFINITY.BOOLEAN), 1);
  assert.equal(applyAffinity(0, AFFINITY.BOOLEAN), 0);
  assert.equal(applyAffinity(null, AFFINITY.INTEGER), null);
  assert.equal(applyAffinity("abc", AFFINITY.INTEGER), "abc");
});

test("LIKE's % and _", () => {
  assert.equal(likeMatch("JavaScript", "Java%"), true);
  assert.equal(likeMatch("Java", "ja_a"), true);
  assert.equal(likeMatch("Java", "j%a"), true);
  assert.equal(likeMatch("Java", "J%x"), false);
  assert.equal(likeMatch("a_b", "a\\_b"), true);
  assert.equal(likeMatch(null, "%"), null);
});

test("groupKey does not conflate 1 and '1'", () => {
  assert.notEqual(groupKey([1]), groupKey(["1"]));
  assert.equal(groupKey([1, null]), groupKey([1, null]));
});

test("displayValue", () => {
  assert.equal(displayValue(null), "NULL");
  assert.equal(displayValue("x"), "x");
  assert.equal(displayValue(3.5), "3.5");
});
