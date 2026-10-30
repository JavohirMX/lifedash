export const SAMPLE_MODE = import.meta.env.DEV && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('sample');
export const DATABASE_NAME = SAMPLE_MODE ? 'lifedash-sample' : 'lifedash';
