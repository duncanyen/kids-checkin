import test from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, occurrenceDate, occurrenceTodo, materializeRecurring, normalizeState, completionDay, validDate } from '../js/todo-core.js';

const template = overrides => ({
    id: 'series', title: '倒垃圾', note: '', category: '生活',
    groupId: 'group-A', accountId: 'owner-A', operator: '建立者',
    assigneeScope: 'members', assigneeAccountIds: ['person-B'], assignees: ['同名'],
    frequency: 'daily', intervalDays: 1, startDate: '2026-10-20', startTime: '09:00',
    endDate: '2026-10-22', active: true, nextIndex: 1, ...overrides
});

test('Taipei date boundaries and legacy completion records', () => {
    assert.equal(dateKey('2026-10-21T16:00:00Z'), '2026-10-22');
    assert.equal(dateKey('2026-10-21T15:59:59Z'), '2026-10-21');
    assert.equal(completionDay({ completedAt: '2026-10-21T16:00:00Z' }), '2026-10-22');
    assert.equal(completionDay({ completedAt: '10/22 09:00' }), null);
    assert.equal(validDate('2026-02-29'), false);
    assert.equal(validDate('2028-02-29'), true);
});

test('daily intervals, weekly cadence, month-end anchors and leap years', () => {
    assert.equal(occurrenceDate(template({ intervalDays: 30 }), 1), '2026-11-19');
    assert.equal(occurrenceDate(template({ frequency: 'weekly' }), 2), '2026-11-03');
    const monthly = template({ frequency: 'monthly', startDate: '2026-01-31' });
    assert.equal(occurrenceDate(monthly, 1), '2026-02-28');
    assert.equal(occurrenceDate(monthly, 2), '2026-03-31');
    const yearly = template({ frequency: 'yearly', startDate: '2024-02-29' });
    assert.equal(occurrenceDate(yearly, 1), '2025-02-28');
    assert.equal(occurrenceDate(yearly, 4), '2028-02-29');
});

test('catch-up is idempotent, time-aware, inclusive of end date and preserves identities', () => {
    const series = template();
    const state = normalizeState({ recurringTemplates: [series], todos: [occurrenceTodo(series, 0)] });
    assert.equal(materializeRecurring(state, new Date('2026-10-21T00:59:59Z')), false);
    assert.equal(materializeRecurring(state, new Date('2026-10-21T01:00:00Z')), true);
    assert.equal(state.todos.length, 2);
    assert.equal(materializeRecurring(state, new Date('2026-10-23T01:00:00Z')), true);
    assert.equal(state.todos.length, 3);
    assert.equal(state.recurringTemplates[0].active, false);
    assert.equal(materializeRecurring(state, new Date('2027-01-01')), false);
    assert.equal(new Set(state.todos.map(todo => todo.id)).size, 3);
    for (const todo of state.todos) {
        assert.equal(todo.accountId, 'owner-A');
        assert.equal(todo.groupId, 'group-A');
        assert.deepEqual(todo.assigneeAccountIds, ['person-B']);
    }
});

test('stopped/future schedules do not generate early and missing documents have no demo tasks', () => {
    const stopped = normalizeState({ recurringTemplates: [template({ active: false })] });
    assert.equal(materializeRecurring(stopped, new Date('2030-01-01')), false);
    const future = normalizeState({ recurringTemplates: [template({ startDate: '2030-01-01', endDate: null })] });
    assert.equal(materializeRecurring(future, new Date('2026-10-22')), false);
    assert.deepEqual(normalizeState().todos, []);
});
