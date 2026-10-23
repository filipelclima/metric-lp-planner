import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Render metadata (og:image, twitter:image…) blocking in <head> for every user agent instead of
  // streaming it into <body>; crawlers such as Twitterbot only read <head>.
  htmlLimitedBots: /.*/,
};

export default nextConfig;
