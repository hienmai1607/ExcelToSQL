import {test,expect} from '@playwright/test';
import {timestamp} from '../src/datetime';
test('timestamps use UTC+7 with AM/PM for SQL UTC and explicit offsets',()=>{
 expect(timestamp('2026-09-23T09:00:00')).toBe('23 Sep 2026, 04:00 PM');
 expect(timestamp('2026-09-23T09:00:00.1234567Z')).toBe('23 Sep 2026, 04:00 PM');
 expect(timestamp('2026-09-23T16:00:00+07:00')).toBe('23 Sep 2026, 04:00 PM');
 expect(timestamp('2026-09-23T17:00:00Z')).toBe('24 Sep 2026, 12:00 AM');
 expect(timestamp('2026-09-23T05:00:00Z')).toBe('23 Sep 2026, 12:00 PM');
 expect(timestamp(null)).toBeNull();
 expect(timestamp('')).toBeNull();
 expect(timestamp('invalid')).toBe('invalid');
});
