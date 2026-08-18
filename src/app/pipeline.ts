import { ok, type Result } from '../shared/result';

export type Step<I, O> = (input: I) => Promise<Result<O>>;

// Typed composition: misordered steps are a compile error.
export function pipeline<A, B, C>(s1: Step<A, B>, s2: Step<B, C>): Step<A, C>;
export function pipeline<A, B, C, D>(s1: Step<A, B>, s2: Step<B, C>, s3: Step<C, D>): Step<A, D>;
export function pipeline<A, B, C, D, E>(s1: Step<A, B>, s2: Step<B, C>, s3: Step<C, D>, s4: Step<D, E>): Step<A, E>;
export function pipeline<A, B, C, D, E, F>(s1: Step<A, B>, s2: Step<B, C>, s3: Step<C, D>, s4: Step<D, E>, s5: Step<E, F>): Step<A, F>;
export function pipeline(...steps: ReadonlyArray<Step<unknown, unknown>>): Step<unknown, unknown> {
  return async (input) => {
    let acc: unknown = input;
    for (const step of steps) {
      const result = await step(acc);
      if (!result.ok) return result;
      acc = result.data;
    }
    return ok(acc);
  };
}
