/**
 * Route Matching Tests
 *
 * Tests for evaluating where conditions and matching route rules.
 * Route rules allow conditional routing based on entity properties.
 *
 * NOTE: Uses step-based flow format where targets are step names (strings).
 */

import { describe, it, expect } from 'vitest';
import { evaluateWhere, matchRoute } from '../../../handoff/route';
import type { WhereCondition, RouteRule } from '../../../types';

describe('Route Matching', () => {
  describe('evaluateWhere', () => {
    describe('simple equality', () => {
      it('matches when property equals value', () => {
        const properties = { type: 'File', content_type: 'image/jpeg' };
        const where: WhereCondition = { property: 'content_type', equals: 'image/jpeg' };

        expect(evaluateWhere(properties, where)).toBe(true);
      });

      it('does not match when property differs', () => {
        const properties = { type: 'File', content_type: 'image/jpeg' };
        const where: WhereCondition = { property: 'content_type', equals: 'image/png' };

        expect(evaluateWhere(properties, where)).toBe(false);
      });

      it('returns false for missing property', () => {
        const properties = { type: 'File' };
        const where: WhereCondition = { property: 'nonexistent', equals: 'value' };

        expect(evaluateWhere(properties, where)).toBe(false);
      });

      it('matches null value explicitly', () => {
        const properties = { type: 'File', content_type: null };
        const where: WhereCondition = { property: 'content_type', equals: null };

        expect(evaluateWhere(properties, where)).toBe(true);
      });

      it('matches numeric values', () => {
        const properties = { count: 42 };
        const where: WhereCondition = { property: 'count', equals: 42 };

        expect(evaluateWhere(properties, where)).toBe(true);
      });

      it('matches boolean values', () => {
        const properties = { active: true };
        const where: WhereCondition = { property: 'active', equals: true };

        expect(evaluateWhere(properties, where)).toBe(true);
      });
    });

    describe('AND conditions', () => {
      it('matches when all conditions match', () => {
        const properties = { type: 'File', content_type: 'image/jpeg', size: 1024 };
        const where: WhereCondition = {
          and: [
            { property: 'type', equals: 'File' },
            { property: 'content_type', equals: 'image/jpeg' },
          ],
        };

        expect(evaluateWhere(properties, where)).toBe(true);
      });

      it('does not match when any condition fails', () => {
        const properties = { type: 'File', content_type: 'image/png' };
        const where: WhereCondition = {
          and: [
            { property: 'type', equals: 'File' },
            { property: 'content_type', equals: 'image/jpeg' },
          ],
        };

        expect(evaluateWhere(properties, where)).toBe(false);
      });

      it('matches with single condition in array', () => {
        const properties = { type: 'File' };
        const where: WhereCondition = {
          and: [{ property: 'type', equals: 'File' }],
        };

        expect(evaluateWhere(properties, where)).toBe(true);
      });

      it('matches with three or more conditions', () => {
        const properties = { a: 1, b: 2, c: 3 };
        const where: WhereCondition = {
          and: [
            { property: 'a', equals: 1 },
            { property: 'b', equals: 2 },
            { property: 'c', equals: 3 },
          ],
        };

        expect(evaluateWhere(properties, where)).toBe(true);
      });
    });

    describe('OR conditions', () => {
      it('matches when first condition matches', () => {
        const properties = { content_type: 'image/jpeg' };
        const where: WhereCondition = {
          or: [
            { property: 'content_type', equals: 'image/jpeg' },
            { property: 'content_type', equals: 'image/png' },
          ],
        };

        expect(evaluateWhere(properties, where)).toBe(true);
      });

      it('matches when second condition matches', () => {
        const properties = { content_type: 'image/png' };
        const where: WhereCondition = {
          or: [
            { property: 'content_type', equals: 'image/jpeg' },
            { property: 'content_type', equals: 'image/png' },
          ],
        };

        expect(evaluateWhere(properties, where)).toBe(true);
      });

      it('does not match when no conditions match', () => {
        const properties = { content_type: 'image/gif' };
        const where: WhereCondition = {
          or: [
            { property: 'content_type', equals: 'image/jpeg' },
            { property: 'content_type', equals: 'image/png' },
          ],
        };

        expect(evaluateWhere(properties, where)).toBe(false);
      });

      it('matches with single condition in array', () => {
        const properties = { type: 'File' };
        const where: WhereCondition = {
          or: [{ property: 'type', equals: 'File' }],
        };

        expect(evaluateWhere(properties, where)).toBe(true);
      });
    });

    describe('nested AND/OR', () => {
      it('handles AND containing OR', () => {
        // (type = File) AND (content_type = jpeg OR content_type = png)
        const where: WhereCondition = {
          and: [
            { property: 'type', equals: 'File' },
            {
              or: [
                { property: 'content_type', equals: 'image/jpeg' },
                { property: 'content_type', equals: 'image/png' },
              ],
            },
          ],
        };

        expect(evaluateWhere({ type: 'File', content_type: 'image/jpeg' }, where)).toBe(true);
        expect(evaluateWhere({ type: 'File', content_type: 'image/png' }, where)).toBe(true);
        expect(evaluateWhere({ type: 'File', content_type: 'image/gif' }, where)).toBe(false);
        expect(evaluateWhere({ type: 'Folder', content_type: 'image/jpeg' }, where)).toBe(false);
      });

      it('handles OR containing AND', () => {
        // (type = File AND size > 0) OR (type = Folder)
        // Simplified since we only have equals: (type = File AND status = active) OR (type = Folder AND status = active)
        const where: WhereCondition = {
          or: [
            {
              and: [
                { property: 'type', equals: 'File' },
                { property: 'status', equals: 'active' },
              ],
            },
            {
              and: [
                { property: 'type', equals: 'Folder' },
                { property: 'status', equals: 'active' },
              ],
            },
          ],
        };

        expect(evaluateWhere({ type: 'File', status: 'active' }, where)).toBe(true);
        expect(evaluateWhere({ type: 'Folder', status: 'active' }, where)).toBe(true);
        expect(evaluateWhere({ type: 'File', status: 'inactive' }, where)).toBe(false);
      });

      it('handles deeply nested conditions', () => {
        const where: WhereCondition = {
          and: [
            { property: 'a', equals: 1 },
            {
              or: [
                { property: 'b', equals: 2 },
                {
                  and: [
                    { property: 'c', equals: 3 },
                    { property: 'd', equals: 4 },
                  ],
                },
              ],
            },
          ],
        };

        // a=1 AND (b=2 OR (c=3 AND d=4))
        expect(evaluateWhere({ a: 1, b: 2 }, where)).toBe(true);
        expect(evaluateWhere({ a: 1, c: 3, d: 4 }, where)).toBe(true);
        expect(evaluateWhere({ a: 1, c: 3, d: 5 }, where)).toBe(false);
        expect(evaluateWhere({ a: 2, b: 2 }, where)).toBe(false);
      });
    });

    describe('nested property paths', () => {
      it('matches simple nested property', () => {
        const properties = { metadata: { format: 'pdf' } };
        const where: WhereCondition = { property: 'metadata.format', equals: 'pdf' };

        expect(evaluateWhere(properties, where)).toBe(true);
      });

      it('matches deeply nested property', () => {
        const properties = { data: { nested: { value: { deep: 'found' } } } };
        const where: WhereCondition = { property: 'data.nested.value.deep', equals: 'found' };

        expect(evaluateWhere(properties, where)).toBe(true);
      });

      it('returns false for partial path match', () => {
        const properties = { metadata: { other: 'value' } };
        const where: WhereCondition = { property: 'metadata.format', equals: 'pdf' };

        expect(evaluateWhere(properties, where)).toBe(false);
      });

      it('returns false when intermediate path is not object', () => {
        const properties = { metadata: 'string-value' };
        const where: WhereCondition = { property: 'metadata.format', equals: 'pdf' };

        expect(evaluateWhere(properties, where)).toBe(false);
      });

      it('handles array indices in path', () => {
        const properties = { items: [{ name: 'first' }, { name: 'second' }] };
        const where: WhereCondition = { property: 'items.0.name', equals: 'first' };

        expect(evaluateWhere(properties, where)).toBe(true);
      });
    });
  });

  describe('matchRoute', () => {
    const rules: RouteRule[] = [
      { where: { property: 'type', equals: 'pdf' }, target: 'pdf_handler' },
      { where: { property: 'type', equals: 'image' }, target: 'image_handler' },
      { where: { property: 'type', equals: 'text' }, target: 'text_handler' },
    ];

    it('returns first matching rule', () => {
      const properties = { type: 'pdf' };

      const result = matchRoute(properties, rules);

      expect(result?.target).toBe('pdf_handler');
    });

    it('returns second rule when first does not match', () => {
      const properties = { type: 'image' };

      const result = matchRoute(properties, rules);

      expect(result?.target).toBe('image_handler');
    });

    it('returns null when no rules match', () => {
      const properties = { type: 'unknown' };

      const result = matchRoute(properties, rules);

      expect(result).toBeNull();
    });

    it('returns null for empty rules array', () => {
      const properties = { type: 'pdf' };

      const result = matchRoute(properties, []);

      expect(result).toBeNull();
    });

    it('returns first matching rule when multiple match', () => {
      const overlappingRules: RouteRule[] = [
        { where: { property: 'priority', equals: 'high' }, target: 'priority_handler' },
        { where: { property: 'type', equals: 'pdf' }, target: 'pdf_handler' },
      ];
      const properties = { type: 'pdf', priority: 'high' };

      const result = matchRoute(properties, overlappingRules);

      // First rule matches first
      expect(result?.target).toBe('priority_handler');
    });

    it('works with complex AND/OR conditions', () => {
      const complexRules: RouteRule[] = [
        {
          where: {
            and: [
              { property: 'type', equals: 'file' },
              { or: [{ property: 'ext', equals: 'jpg' }, { property: 'ext', equals: 'png' }] },
            ],
          },
          target: 'image_handler',
        },
        { where: { property: 'type', equals: 'file' }, target: 'default_file_handler' },
      ];

      expect(matchRoute({ type: 'file', ext: 'jpg' }, complexRules)?.target).toBe('image_handler');
      expect(matchRoute({ type: 'file', ext: 'pdf' }, complexRules)?.target).toBe('default_file_handler');
    });
  });
});
