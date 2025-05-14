import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          prompt:       "consent",
          access_type:  "offline",
          response_type:"code",
          scope: `
            openid
            email
            profile
            https://www.googleapis.com/auth/gmail.modify
            https://www.googleapis.com/auth/gmail.labels
            https://www.googleapis.com/auth/calendar.events
          `.trim().replace(/\s+/g," ")
        }
      }
    })
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken  = account.access_token;
        token.refreshToken = account.refresh_token;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.accessToken  = token.accessToken;
      session.user.refreshToken = token.refreshToken;
      return session;
    }
  }
};

export default NextAuth(authOptions);