/**
 * Bearer token authentication middleware for EctoClaw.
 * 
 * Roles: admin, auditor, agent
 * Token lookup: SHA-256(token) → stored hash → role
 */

import type { Request, Response, NextFunction } from "express";
import { sha256Hex } from "../core/hash.js";
import type { SqliteLedger } from "../ledger/sqlite.js";

export type Role = "admin" | "auditor" | "agent";

declare global {
  namespace Express {
    interface Request {
      role?: Role;
      tokenHash?: string;
    }
  }
}

export function createAuthMiddleware(ledger: SqliteLedger, devMode: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Dev mode: allow all requests as admin
    if (devMode) {
      req.role = "admin";
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    const queryToken = req.query.token as string | undefined;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : queryToken;

    if (!token) {
      res.status(401).json({ error: "Missing authentication token" });
      return;
    }

    const tokenHash = sha256Hex(token);
    const role = ledger.getTokenRole(tokenHash);

    if (!role) {
      res.status(403).json({ error: "Invalid or revoked token" });
      return;
    }

    req.role = role as Role;
    req.tokenHash = tokenHash;
    next();
  };
}

/** Middleware to require a minimum role level. */
export function requireRole(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.role || !allowedRoles.includes(req.role)) {
      res.status(403).json({ error: `Requires one of: ${allowedRoles.join(", ")}` });
      return;
    }
    next();
  };
}
