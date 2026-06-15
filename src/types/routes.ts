import { Store } from '#/types/database';
export type TokenRoute =
  | {
      action: 'token';
      kind: 'secret';
      name: string;
    }
  | {
      action: 'token';
      kind: 'variable';
      name: string;
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

export type PutSecretsRoute = {
  action: 'putSecrets';
};

export type Route =
  | HealthRoute
  | OperationRoute
  | SnapshotRoute
  | ApplyRoute
  | StatusRoute
  | UpdateManifestRoute
  | TokenRoute
  | PutSecretsRoute;
