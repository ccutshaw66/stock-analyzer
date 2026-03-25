import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { storage } from "./storage";
import { sendPasswordResetEmail, sendWelcomeEmail } from "./email";

const JWT_SECRET = process.env.JWT_SECRET || "stockotter-jwt-secret-change-in-production-2026";
const JWT_EXPIRES_IN = "7d";
const COOKIE_NAME = "stockotter_token";

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: { id: number; email: string; displayName: string | null };
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function signToken(userId: number): string {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token: string): { userId: number } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: number };
  } catch {
    return null;
  }
}

// ─── Middleware ────────────────────────────────────────────────────────────────

/** Require authentication — returns 401 if not logged in */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME] || req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  const user = await storage.getUser(payload.userId);
  if (!user) {
    return res.status(401).json({ error: "User not found" });
  }

  req.user = { id: user.id, email: user.email, displayName: user.displayName };
  next();
}

/** Optional auth — sets req.user if token present but doesn't block */
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME] || req.headers.authorization?.replace("Bearer ", "");

  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      const user = await storage.getUser(payload.userId);
      if (user) {
        req.user = { id: user.id, email: user.email, displayName: user.displayName };
      }
    }
  }
  next();
}

// ─── Auth Route Handlers ──────────────────────────────────────────────────────

export async function registerHandler(req: Request, res: Response) {
  try {
    const { email, password, displayName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Check if email already exists
    const existing = await storage.getUserByEmail(email.toLowerCase().trim());
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const hashedPassword = await hashPassword(password);
    const user = await storage.createUser({
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      displayName: displayName || null,
    });

    const token = signToken(user.id);

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: "/",
    });

    res.json({
      user: { id: user.id, email: user.email, displayName: user.displayName },
    });

    // Send welcome email (non-blocking)
    sendWelcomeEmail(user.email, user.displayName).catch(() => {});
  } catch (error: any) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Failed to create account" });
  }
}

export async function loginHandler(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await storage.getUserByEmail(email.toLowerCase().trim());
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = signToken(user.id);

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    res.json({
      user: { id: user.id, email: user.email, displayName: user.displayName },
    });
  } catch (error: any) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Failed to log in" });
  }
}

export async function logoutHandler(_req: Request, res: Response) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ success: true });
}

export async function meHandler(req: Request, res: Response) {
  // req.user is set by requireAuth middleware
  const user = await storage.getUser(req.user!.id);
  res.json({ user: user ? { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt } : req.user });
}

// ─── Profile & Password Handlers ──────────────────────────────────────────────

export async function updateProfileHandler(req: Request, res: Response) {
  try {
    const { email, displayName } = req.body;
    const updates: { email?: string; displayName?: string } = {};

    if (email !== undefined) {
      const normalized = email.toLowerCase().trim();
      if (!normalized) return res.status(400).json({ error: "Email cannot be empty" });
      // Check if email is taken by another user
      const existing = await storage.getUserByEmail(normalized);
      if (existing && existing.id !== req.user!.id) {
        return res.status(409).json({ error: "Email already in use" });
      }
      updates.email = normalized;
    }

    if (displayName !== undefined) {
      updates.displayName = displayName || null;
    }

    const user = await storage.updateUserProfile(req.user!.id, updates);
    res.json({ user: { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt } });
  } catch (error: any) {
    console.error("Update profile error:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
}

export async function changePasswordHandler(req: Request, res: Response) {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current password and new password are required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "New password must be at least 6 characters" });
    }

    const user = await storage.getUser(req.user!.id);
    if (!user) return res.status(401).json({ error: "User not found" });

    const valid = await verifyPassword(currentPassword, user.password);
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const hashed = await hashPassword(newPassword);
    await storage.updateUserPassword(user.id, hashed);
    res.json({ success: true });
  } catch (error: any) {
    console.error("Change password error:", error);
    res.status(500).json({ error: "Failed to change password" });
  }
}

export async function forgotPasswordHandler(req: Request, res: Response) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required" });

    const user = await storage.getUserByEmail(email.toLowerCase().trim());
    // Always return success to prevent email enumeration
    if (!user) return res.json({ success: true });

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await storage.createPasswordResetToken(user.id, token, expiresAt);

    // Send reset email
    const sent = await sendPasswordResetEmail(user.email, token, user.displayName);
    if (!sent) {
      console.log(`[auth] Email failed, reset token for ${email}: ${token}`);
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Failed to process request" });
  }
}

export async function resetPasswordHandler(req: Request, res: Response) {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password are required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const resetToken = await storage.getPasswordResetToken(token);
    if (!resetToken) {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }

    if (new Date() > resetToken.expiresAt) {
      await storage.deletePasswordResetToken(token);
      return res.status(400).json({ error: "Reset token has expired" });
    }

    const hashed = await hashPassword(newPassword);
    await storage.updateUserPassword(resetToken.userId, hashed);
    await storage.deletePasswordResetToken(token);

    res.json({ success: true });
  } catch (error: any) {
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Failed to reset password" });
  }
}
