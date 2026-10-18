import type { OrcaBridge } from '../../preload/api';

declare global {
  interface Window {
    orca: OrcaBridge;
  }
}
