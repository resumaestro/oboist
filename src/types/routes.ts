import { Store } from '#/types/database';
export type TokenKind = 'secret' | 'variable';

export type TokenRoute = {
  action: 'token';
  kind: TokenKind;
};

export type HealthRoute = {
  action: 'health';
  target: string;
};

export type OperationRoute = {
  action: 'operation';
  target: Store;
};

export type SnapshotRoute = {
  action: 'snapshot';
  target: Store;
};

export type ApplyRoute = {
  action: 'apply';
  target: Store | null;
};

export type StatusRoute = {
  action: 'status';
  target: Store;
  kind: 'migration' | 'seed' | 'apply' | null;
};

export type UpdateManifestRoute = {
  action: 'updateManifest';
};

export type Route =
  | HealthRoute
  | OperationRoute
  | SnapshotRoute
  | ApplyRoute
  | StatusRoute
  | UpdateManifestRoute
  | TokenRoute;
