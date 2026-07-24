import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface DatasetRef {
    id: string;
    name: string;
}
export interface SavedRun {
    id: bigint;
    report: Report;
    patterns: Array<Pattern>;
    owner: Principal;
    name: string;
    datasets: Array<DatasetRef>;
    savedAtNs: bigint;
    config: DiscoveryConfig;
    validation: ValidationResult;
}
export interface Result {
    hasMore: boolean;
    rows: Array<Array<Cell>>;
}
export interface Pattern {
    id: string;
    name: string;
    mfeMaeRatio: number;
    plainEnglishSentence: string;
    coverage: number;
    winRate: number;
}
export interface Cell {
    value: Value;
    name: string;
}
export interface ValidationResult {
    outOfSampleWinRate: number;
    inSampleWinRate: number;
    byMarketCondition: Array<[string, number]>;
}
export type Result__1 = {
    __kind__: "ok";
    ok: null;
} | {
    __kind__: "err";
    err: Error_;
};
export type Error_ = {
    __kind__: "FrontendOriginsNotConfigured";
    FrontendOriginsNotConfigured: null;
} | {
    __kind__: "MixedSsoSources";
    MixedSsoSources: {
        otherKeys: Array<string>;
        ssoKeys: Array<string>;
    };
} | {
    __kind__: "Stale";
    Stale: {
        ageNs: bigint;
    };
} | {
    __kind__: "MalformedCandid";
    MalformedCandid: null;
} | {
    __kind__: "AmbiguousAttribute";
    AmbiguousAttribute: {
        field: string;
        sources: Array<string>;
    };
} | {
    __kind__: "NoAttributes";
    NoAttributes: null;
} | {
    __kind__: "UnknownNonce";
    UnknownNonce: null;
} | {
    __kind__: "UntrustedSsoSource";
    UntrustedSsoSource: {
        domain: string;
    };
} | {
    __kind__: "MissingField";
    MissingField: string;
} | {
    __kind__: "FrontendOriginMismatch";
    FrontendOriginMismatch: {
        got: string;
        expected: Array<string>;
    };
};
export type Value = {
    __kind__: "int";
    int: bigint;
} | {
    __kind__: "nat";
    nat: bigint;
} | {
    __kind__: "float";
    float: number;
} | {
    __kind__: "bool";
    bool: boolean;
} | {
    __kind__: "null";
    null: null;
} | {
    __kind__: "text";
    text: string;
};
export interface Report {
    summary: string;
    generatedAtNs: bigint;
}
export interface DiscoveryConfig {
    minMfeMaeRatio: number;
    horizon: bigint;
    mfeMaeWindow: bigint;
    mfeMaeRatioEnabled: boolean;
    minSampleSize: bigint;
    maxDepth: bigint;
    minWinRate: number;
}
export interface SavedRunSummary {
    id: bigint;
    patternCount: bigint;
    name: string;
    configSummary: string;
    datasetName: string;
    savedAtNs: bigint;
}
export enum UserRole {
    admin = "admin",
    user = "user",
    guest = "guest"
}
export interface backendInterface {
    assignCallerUserRole(user: Principal, role: UserRole): Promise<void>;
    deleteMyRun(runId: bigint): Promise<boolean>;
    execute(qJson: string): Promise<Result>;
    getCallerUserRole(): Promise<UserRole>;
    getMyRun(runId: bigint): Promise<SavedRun | null>;
    getMyRuns(runIds: Array<bigint>): Promise<Array<SavedRun>>;
    isCallerAdmin(): Promise<boolean>;
    listMyRunSummaries(): Promise<Array<SavedRunSummary>>;
    listMyRuns(): Promise<Array<SavedRun>>;
    saveRun(run: SavedRun): Promise<SavedRun>;
    schema(): Promise<string>;
}
