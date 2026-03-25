import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";
import { UserCircle, Mail, Lock, Save, Loader2, Eye, EyeOff, CheckCircle2 } from "lucide-react";

export default function AccountPage() {
  const { user, refreshUser } = useAuth();

  // Profile state
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [email, setEmail] = useState(user?.email || "");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");
  const [profileError, setProfileError] = useState("");

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError("");
    setProfileMsg("");
    setProfileLoading(true);
    try {
      const res = await apiRequest("PATCH", "/api/auth/profile", { email, displayName });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update profile");
      }
      setProfileMsg("Profile updated successfully");
      refreshUser?.();
    } catch (err: any) {
      setProfileError(err.message);
    } finally {
      setProfileLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordMsg("");

    if (newPassword !== confirmPassword) {
      setPasswordError("Passwords do not match");
      return;
    }

    setPasswordLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/change-password", { currentPassword, newPassword });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to change password");
      }
      setPasswordMsg("Password changed successfully");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setPasswordError(err.message);
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="p-3 sm:p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-foreground">Account Settings</h1>

      {/* Profile Card */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <UserCircle className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-bold text-foreground">Profile</h2>
        </div>

        <form onSubmit={handleProfileSave} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full h-9 pl-10 pr-3 text-sm bg-background border border-card-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {user?.createdAt && (
            <p className="text-[11px] text-muted-foreground">
              Account created {new Date(user.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
            </p>
          )}

          {profileError && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-2.5 text-xs text-destructive">{profileError}</div>
          )}
          {profileMsg && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2.5 text-xs text-green-400 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> {profileMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={profileLoading}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          >
            {profileLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Changes
          </button>
        </form>
      </div>

      {/* Security Card */}
      <div className="bg-card border border-card-border rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Lock className="h-5 w-5 text-primary" />
          <h2 className="text-sm font-bold text-foreground">Change Password</h2>
        </div>

        <form onSubmit={handlePasswordChange} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Current Password</label>
            <div className="relative">
              <input
                type={showCurrent ? "text" : "password"}
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                required
                className="w-full h-9 px-3 pr-10 text-sm bg-background border border-card-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">New Password</label>
            <div className="relative">
              <input
                type={showNew ? "text" : "password"}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                minLength={6}
                placeholder="At least 6 characters"
                className="w-full h-9 px-3 pr-10 text-sm bg-background border border-card-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              className="w-full h-9 px-3 text-sm bg-background border border-card-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          {passwordError && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-2.5 text-xs text-destructive">{passwordError}</div>
          )}
          {passwordMsg && (
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2.5 text-xs text-green-400 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> {passwordMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={passwordLoading}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          >
            {passwordLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            Change Password
          </button>
        </form>
      </div>
    </div>
  );
}
