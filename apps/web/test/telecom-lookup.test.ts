import { describe, it, expect } from 'vitest';
import { lookupTelecomDetails } from '../lib/telecom';

describe('Telecom Operator & Circle Lookup Engine', () => {
  it('accurately resolves 9144381574 as Jio in West Bengal', () => {
    const result = lookupTelecomDetails('9144381574');
    expect(result).not.toBeNull();
    expect(result?.operator).toBe('JIO');
    expect(result?.operatorName).toBe('Jio');
    expect(result?.circle).toBe('West Bengal');
  });

  it('accurately resolves 9733671094 as Vi in West Bengal', () => {
    const result = lookupTelecomDetails('9733671094');
    expect(result).not.toBeNull();
    expect(result?.operator).toBe('VI');
    expect(result?.operatorName).toBe('Vi');
    expect(result?.circle).toBe('West Bengal');
  });

  it('accurately resolves 8967 series as Airtel in West Bengal', () => {
    const result = lookupTelecomDetails('8967123456');
    expect(result).not.toBeNull();
    expect(result?.operator).toBe('AIRTEL');
    expect(result?.circle).toBe('West Bengal');
  });

  it('accurately resolves 9434 series as BSNL in West Bengal', () => {
    const result = lookupTelecomDetails('9434123456');
    expect(result).not.toBeNull();
    expect(result?.operator).toBe('BSNL');
    expect(result?.circle).toBe('West Bengal');
  });

  it('returns null for incomplete numbers under 10 digits', () => {
    expect(lookupTelecomDetails('9144381')).toBeNull();
  });
});

