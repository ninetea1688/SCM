import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

/** Parse a request body/query with zod; 400 with field issues on failure. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new BadRequestException({
      code: 'invalid_input',
      issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}
