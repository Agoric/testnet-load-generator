/* global Buffer */

import type { TimeValueS } from '../helpers/time.js';

export interface EnvInfo {
  readonly agChainCosmosVersion?: unknown;
}

export interface SDKBinaries {
  readonly agSolo: string;
  readonly cosmosChain: string;
  readonly cosmosHelper: string;
}

export type SetupTasksResult = {
  readonly chainStorageLocation?: string;
  readonly clientStorageLocation?: string;
};

export type TaskResult = {
  readonly stop: () => void;
  readonly done: Promise<void>;
  readonly ready: Promise<void>;
};

export type RunKernelInfo = {
  readonly slogLines: AsyncIterable<Buffer>;
  readonly processInfo:
    | import('../helpers/process-info.js').ProcessInfo
    | undefined;
};

export type TaskEventStatus = Record<string, unknown> & {
  time: TimeValueS;
  type: 'status';
};

export type TaskEventStart = {
  time: TimeValueS;
  type: 'start';
  task: string;
  seq: number;
};

export type TaskEventFinish = {
  time: TimeValueS;
  type: 'finish';
  task: string;
  seq: number;
  success: boolean;
};

export type TaskEvent = TaskEventStatus | TaskEventStart | TaskEventFinish;

export type RunLoadgenInfo = {
  readonly taskEvents: AsyncIterable<TaskEvent>;
  updateConfig(newConfig: unknown): Promise<void>;
};

export type RunChainResult = TaskResult & RunKernelInfo;
export type RunClientResult = TaskResult & RunKernelInfo;
export type RunLoadgenResult = TaskResult & RunLoadgenInfo;

export interface TaskBaseOptions {
  readonly stdout: import('stream').Writable;
  readonly stderr: import('stream').Writable;
  readonly timeout?: number;
  readonly orInterrupt?: (job?: Promise<any>) => Promise<any>;
  readonly config?: unknown;
}

export type CosmicSwingSetTracingKeys = 'xsnap' | 'kvstore' | 'swingstore';
export interface TaskSwingSetOptions extends TaskBaseOptions {
  readonly trace?:
    | Partial<Record<CosmicSwingSetTracingKeys, string>>
    | undefined;
}

export interface OrchestratorTasks {
  getEnvInfo(options: TaskBaseOptions): Promise<EnvInfo>;
  setupTasks(options: TaskBaseOptions): Promise<SetupTasksResult>;
  runChain(options: TaskSwingSetOptions): Promise<RunChainResult>;
  runClient(options: TaskSwingSetOptions): Promise<RunClientResult>;
  runLoadgen(options: TaskBaseOptions): Promise<RunLoadgenResult>;
}

/* eslint-disable camelcase */
export type CometBFTConfig = {
  proxy_app: string;
  moniker: string;
  fast_sync: boolean;
  db_backend: string;
  db_dir: string;
  log_level?: string;
  log_format: string;
  genesis_file: string;
  priv_validator_key_file: string;
  priv_validator_state_file: string;
  priv_validator_laddr: string;
  node_key_file: string;
  abci: string;
  filter_peers: boolean;
  rpc: {
    laddr: string;
    cors_allowed_origins: string[];
    cors_allowed_methods: string[];
    cors_allowed_headers: string[];
    grpc_laddr: string;
    grpc_max_open_connections: number;
    unsafe: boolean;
    max_open_connections: number;
    max_subscription_clients: number;
    max_subscriptions_per_client: number;
    experimental_subscription_buffer_size: number;
    experimental_websocket_write_buffer_size: number;
    experimental_close_on_slow_client: boolean;
    timeout_broadcast_tx_commit: string;
    max_body_bytes: number;
    max_header_bytes: number;
    tls_cert_file: string;
    tls_key_file: string;
    pprof_laddr: string;
  };
  p2p: {
    laddr: string;
    external_address: string;
    seeds: string;
    persistent_peers: string;
    upnp: boolean;
    addr_book_file: string;
    addr_book_strict: boolean;
    max_num_inbound_peers: number;
    max_num_outbound_peers: number;
    unconditional_peer_ids: string;
    persistent_peers_max_dial_period: string;
    flush_throttle_timeout: string;
    max_packet_msg_payload_size: number;
    send_rate: number;
    recv_rate: number;
    pex: boolean;
    seed_mode: boolean;
    private_peer_ids: string;
    allow_duplicate_ip: boolean;
    handshake_timeout: string;
    dial_timeout: string;
  };
  mempool: {
    version: string;
    recheck: boolean;
    broadcast: boolean;
    wal_dir: string;
    size: number;
    max_txs_bytes: number;
    cache_size: number;
    keep_invalid_txs_in_cache: boolean;
    max_tx_bytes: number;
    max_batch_bytes: number;
    ttl_duration: string;
    ttl_num_blocks: number;
  };
  statesync: {
    enable: boolean;
    rpc_servers: string;
    trust_height: number;
    trust_hash: string;
    trust_period: string;
    discovery_time: string;
    temp_dir: string;
    chunk_request_timeout: string;
    chunk_fetchers: string;
  };
  fastsync: {
    version: string;
  };
  consensus: {
    wal_file: string;
    timeout_propose: string;
    timeout_propose_delta: string;
    timeout_prevote: string;
    timeout_prevote_delta: string;
    timeout_precommit: string;
    timeout_precommit_delta: string;
    timeout_commit: string;
    double_sign_check_height: number;
    skip_timeout_commit: boolean;
    create_empty_blocks: boolean;
    create_empty_blocks_interval: string;
    peer_gossip_sleep_duration: string;
    peer_query_maj23_sleep_duration: string;
  };
  storage: {
    discard_abci_responses: boolean;
  };
  tx_index: {
    indexer: string;
    psql_conn: string;
    index_all_keys: boolean;
  };
  instrumentation: {
    prometheus: boolean;
    prometheus_listen_addr: string;
    max_open_connections: number;
    namespace: string;
  };
};
/* eslint-enable camelcase */
