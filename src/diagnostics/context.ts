import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Device / build context stamped into the diagnostics bundle (D16) so a
 * report carries "which build, which OS, what network" instead of just
 * "it failed".
 */
export interface DeviceContext {
  appVersion: string;
  appName: string;
  platform: string;
  osVersion: string;
  isDev: boolean;
  /** Last value seen by the NetInfo listener; 'unknown' until one arrives. */
  networkType: string;
  networkConnected: boolean | null;
}

let networkType = 'unknown';
let networkConnected: boolean | null = null;

export function setNetworkContext(type: string | null, connected: boolean | null): void {
  networkType = type ?? 'unknown';
  networkConnected = connected;
}

export function deviceContext(): DeviceContext {
  return {
    appVersion: Constants.expoConfig?.version ?? 'unknown',
    appName: Constants.expoConfig?.name ?? 'Binocular',
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
    networkType,
    networkConnected,
  };
}
