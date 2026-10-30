import { describe, it, expect } from 'vitest';

export type UserRole = 'owner' | 'admin' | 'viewer';

export interface UserPermission {
  canCreatePairingCode: boolean;
  canRevokeDevice: boolean;
  canExportData: boolean;
  canIngestData: boolean;
  canViewDashboard: boolean;
}

export function getRolePermissions(role: UserRole): UserPermission {
  switch (role) {
    case 'owner':
      return {
        canCreatePairingCode: true,
        canRevokeDevice: true,
        canExportData: true,
        canIngestData: false, // Ingestion is scoped to device tokens only
        canViewDashboard: true,
      };
    case 'admin':
      return {
        canCreatePairingCode: true,
        canRevokeDevice: true,
        canExportData: true,
        canIngestData: false,
        canViewDashboard: true,
      };
    case 'viewer':
      return {
        canCreatePairingCode: false,
        canRevokeDevice: false,
        canExportData: false,
        canIngestData: false,
        canViewDashboard: true,
      };
  }
}

describe('Step 10 Hardening: Membership Role Permissions (Owner vs Viewer)', () => {
  it('allows owner to create pairing codes, revoke devices, and export data', () => {
    const ownerPerms = getRolePermissions('owner');
    expect(ownerPerms.canCreatePairingCode).toBe(true);
    expect(ownerPerms.canRevokeDevice).toBe(true);
    expect(ownerPerms.canExportData).toBe(true);
    expect(ownerPerms.canViewDashboard).toBe(true);
  });

  it('strictly forbids viewer from creating pairing codes, revoking devices, or exporting data', () => {
    const viewerPerms = getRolePermissions('viewer');
    expect(viewerPerms.canCreatePairingCode).toBe(false);
    expect(viewerPerms.canRevokeDevice).toBe(false);
    expect(viewerPerms.canExportData).toBe(false);
    expect(viewerPerms.canViewDashboard).toBe(true);
  });
});
