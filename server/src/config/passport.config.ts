import passport from "passport";
import { Strategy as GoogleStrategy, type Profile as GoogleProfile } from "passport-google-oauth20";
import { Strategy as GitHubStrategy, type Profile as GitHubProfile } from "passport-github2";
import { Strategy as FacebookStrategy, type Profile as FacebookProfile } from "passport-facebook";
import { UserModel } from "@/models/user.model";
import { getEnv } from "@/config/env.config";
import type { IUser } from "@/types/models";

// ─── Types ────────────────────────────────────────────────────────────────────
type OAuthProfile = GoogleProfile | GitHubProfile | FacebookProfile;
type OAuthProvider = "google" | "github" | "facebook";
// passport's done callback signature
type DoneFn = (error: Error | null, user?: Express.User | false) => void;

// ─── Serialize / Deserialize ─────────────────────────────────────────────────
passport.serializeUser((user: Express.User, done) => {
  // Cast needed because Express.User is a bare interface
  done(null, (user as IUser)._id.toString());
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await UserModel.findById(id).select("-password");
    // findById returns null when not found; passport accepts null as "no user"
    done(null, user ?? false);
  } catch (err) {
    done(err as Error, false);
  }
});

// ─── Shared OAuth handler ────────────────────────────────────────────────────
const handleOAuthCallback = async (profile: OAuthProfile, provider: OAuthProvider, done: DoneFn): Promise<void> => {
  try {
    const email = profile.emails?.[0]?.value;

    if (!email) {
      done(new Error(`No email returned from ${provider} profile`));
      return;
    }

    // Try to find by provider + providerId first (more precise),
    // then fall back to email so existing local accounts get linked.
    let user = await UserModel.findOne({
      $or: [{ providerId: profile.id, provider }, { email }],
    });

    if (!user) {
      user = await UserModel.create({
        // GitHub profiles use `username`; others use `displayName`
        name:
          profile.displayName ||
          ("username" in profile ? profile.username : "") ||
          email.split("@")[0],
        email,
        provider,
        providerId: profile.id,
        avatar: profile.photos?.[0]?.value,
      });
    }

    done(null, user);
  } catch (err) {
    done(err as Error);
  }
};

// ─── Google ───────────────────────────────────────────────────────────────────
const googleClientId = getEnv("GOOGLE_CLIENT_ID");
const googleClientSecret = getEnv("GOOGLE_CLIENT_SECRET");

if (googleClientId && googleClientSecret) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: googleClientId,
        clientSecret: googleClientSecret,
        callbackURL: "/api/v1/auth/google/callback",
        scope: ["profile", "email"],
      },
      (_accessToken, _refreshToken, profile, done) =>
        void handleOAuthCallback(profile, "google", done),
    ),
  );
  console.log("Google OAuth configured");
} else {
  console.warn("Google OAuth skipped — missing credentials");
}

// ─── GitHub ───────────────────────────────────────────────────────────────────
const githubClientId = getEnv("GITHUB_CLIENT_ID");
const githubClientSecret = getEnv("GITHUB_CLIENT_SECRET");

if (githubClientId && githubClientSecret) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: githubClientId,
        clientSecret: githubClientSecret,
        callbackURL: "/api/v1/auth/github/callback",
        scope: ["user:email"],
      },
      (_accessToken: string, _refreshToken: string, profile: GitHubProfile, done: DoneFn) =>
        void handleOAuthCallback(profile, "github", done),
    ),
  );
  console.log("GitHub OAuth configured");
} else {
  console.warn("GitHub OAuth skipped — missing credentials");
}

// ─── Facebook ─────────────────────────────────────────────────────────────────
const facebookAppId = getEnv("FACEBOOK_APP_ID");
const facebookAppSecret = getEnv("FACEBOOK_APP_SECRET");

if (facebookAppId && facebookAppSecret) {
  passport.use(
    new FacebookStrategy(
      {
        clientID: facebookAppId,
        clientSecret: facebookAppSecret,
        callbackURL: "/api/v1/auth/facebook/callback",
        profileFields: ["id", "displayName", "emails", "photos"],
      },
      (_accessToken, _refreshToken, profile, done) =>
        void handleOAuthCallback(profile, "facebook", done),
    ),
  );
  console.log("Facebook OAuth configured");
} else {
  console.warn("Facebook OAuth skipped — missing credentials");
}