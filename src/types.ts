export type ConfigDevice = {
    displayName: string;
    host: string;
    port: number;
    mac?: string;
    username?: string;
    password?: string;
};
export type GarageLockType = 'lock' | 'lock_remotes';
export type GarageLightType = 'garage_light' | 'light';
export type GarageCoverType = 'garage_door' | 'door';
export type LockStateType = 'UNSECURED' | 'SECURED' | 'JAMMED' | 'UNKNOWN';
export type CurrentOperationType = 'IDLE' | 'OPENING' | 'CLOSING';
export type OpenClosedStateType = 'CLOSED' | 'OPEN';

export type BlaQCoverDoorEvent = {
    id: string;
    state: 'CLOSED' | 'OPEN';
    value: number;
    current_operation: 'IDLE' | 'OPENING' | 'CLOSING';
    position: number;
};

export type BlaQBinarySensorEvent = {
    id: string;
    name: string;
    //icon: string;
    //entity_category: int;
    value: boolean;
    state: 'OFF' | 'ON';
};

export type BlaQButtonEvent = {
    id: string;
    name: string;
    //icon: string;
    //entity_category: int;
};

export type BlaQTextSensorEvent = {
    id: string;
    name: string;
    //icon: string;
    //entity_category: int;
    value: string;
    state: string;
};

export type BlaQLockEvent = {
    id: string;
    name: string;
    //icon: string;
    //entity_category: int;
    value: number;
    state: string;
};