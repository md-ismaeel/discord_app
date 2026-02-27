import passport from "passport";
import { Strategy as GoogleStrategy, Profile as GoogleProfile } from "passport-google-oauth20";
import { Strategy as GitHubStrategy, Profile as GitHubProfile } from "passport-github2";
import { Strategy as FacebookStrategy, Profile as FacebookProfile } from "passport-facebook";
import { UserModel } from "../models/user.model";
import { getEnv } from "./env.config";
import { IUser } from "@/types/models";

// Properly type the serialize/deserialize functions
passport.serializeUser((user: Express.User, done) => {
  done(null, (user as IUser)._id.toString());
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await UserModel.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

// Type the OAuth callback handler
type OAuthProfile = GoogleProfile | GitHubProfile | FacebookProfile;
type Provider = "google" | "github" | "facebook";

const handleOAuthCallback = async (
  profile: OAuthProfile,
  provider: Provider,
  done: (error: any, user?: any) => void
): Promise<void> => {
  try {
    const email = profile.emails?.[0]?.value;

    if (!email) {
      return done(new Error("No email found in profile"), null);
    }

    let user = await UserModel.findOne({ email });

    if (!user) {
      user = await UserModel.create({
        name: profile.displayName || (profile as any).username,
        email,
        provider,
        providerId: profile.id,
        avatar: profile.photos?.[0]?.value || null,
      });
    }

    done(null, user);
  } catch (err) {
    done(err, null);
  }
};

// Google Strategy
const googleClientId = getEnv("GOOGLE_CLIENT_ID");
const googleClientSecret = getEnv("GOOGLE_CLIENT_SECRET");

if (googleClientId && googleClientSecret) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: googleClientId,
        clientSecret: googleClientSecret,
        callbackURL: "/api/auth/google/callback",
      },
      (_accessToken: string, _refreshToken: string, profile: GoogleProfile, done) =>
        handleOAuthCallback(profile, "google", done)
    )
  );
  console.log("Google OAuth configured");
} else {
  console.log("Google OAuth not configured (missing credentials)");
}

// GitHub Strategy
const githubClientId = getEnv("GITHUB_CLIENT_ID");
const githubClientSecret = getEnv("GITHUB_CLIENT_SECRET");

if (githubClientId && githubClientSecret) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: githubClientId,
        clientSecret: githubClientSecret,
        callbackURL: "/api/auth/github/callback",
        scope: ["user:email"],
      },
      (_accessToken: string, _refreshToken: string, profile: GitHubProfile, done) =>
        handleOAuthCallback(profile, "github", done)
    )
  );
  console.log("GitHub OAuth configured");
} else {
  console.log("GitHub OAuth not configured (missing credentials)");
}

// Facebook Strategy
const facebookAppId = getEnv("FACEBOOK_APP_ID");
const facebookAppSecret = getEnv("FACEBOOK_APP_SECRET");

if (facebookAppId && facebookAppSecret) {
  passport.use(
    new FacebookStrategy(
      {
        clientID: facebookAppId,
        clientSecret: facebookAppSecret,
        callbackURL: "/api/auth/facebook/callback",
        profileFields: ["id", "displayName", "emails", "photos"],
      },
      (_accessToken: string, _refreshToken: string, profile: FacebookProfile, done) =>
        handleOAuthCallback(profile, "facebook", done)
    )
  );
  console.log("Facebook OAuth configured");
} else {
  console.log("Facebook OAuth not configured (missing credentials)");
}