import test from 'node:test';
import assert from 'node:assert/strict';
import {normalisePhone,normaliseEmployeeCode} from '../src/access/identity.js';
test('employee codes accept exactly five digits and store the SCE prefix',()=>{assert.equal(normaliseEmployeeCode('00001'),'SCE/00001');assert.equal(normaliseEmployeeCode('sce/00001'),'SCE/00001');assert.throws(()=>normaliseEmployeeCode('1'),/five digits/);assert.throws(()=>normaliseEmployeeCode('SCE/123456'),/five digits/)});
test('local phone login input normalises country code without accepting invalid identifiers',()=>{assert.equal(normalisePhone('98765 43210'),'+919876543210');assert.throws(()=>normalisePhone('+91 9876543210'),/10-digit/);assert.throws(()=>normalisePhone('1234567890'),/10-digit/);assert.throws(()=>normalisePhone('0000'),/10-digit/);assert.throws(()=>normalisePhone('employee@example.com'),/10-digit/)});
