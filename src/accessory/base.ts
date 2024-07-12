import { LogMessageEvent, PingMessageEvent, StateUpdateMessageEvent } from '../utils/eventsource';

export interface BaseBlaQAccessory {
    setAPIBaseURL: (apiBaseURL: string) => void;
    handleStateEvent: (stateEvent: StateUpdateMessageEvent) => void;
    handleLogEvent?: (logEvent: LogMessageEvent) => void;
    handlePingEvent?: (pingEvent: PingMessageEvent) => void;
}
