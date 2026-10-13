/** Source of the current time; tests replace it instead of sleeping. */
export type Clock = () => Date;

export const CLOCK = Symbol('CLOCK');
