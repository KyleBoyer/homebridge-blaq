export type ConfigDevice = {
    displayName: string;
    host: string;
    port: number;
    mac?: string;
    username?: string;
    password?: string;
    encryptionKey?: string;
};
export type LockStateType = 'UNSECURED' | 'SECURED' | 'JAMMED' | 'UNKNOWN';
export type CurrentOperationType = 'IDLE' | 'OPENING' | 'CLOSING';
export type OpenClosedStateType = 'CLOSED' | 'OPEN';
