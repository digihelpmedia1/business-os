import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer", "@prisma/client", "bcryptjs"],
  experimental: {
    serverActions: { bodySizeLimit: "5mb" },
  },
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/pdf/**": ["./src/assets/fonts/**"],
    "/share/**": ["./src/assets/fonts/**"],
  },
  agentRules: false,
  async redirects() {
    // Section URLs people type or bookmark → their main page (instead of a 404).
    return [
      { source: "/favicon.ico", destination: "/icon.svg", permanent: true },
      { source: "/billing", destination: "/billing/invoices", permanent: false },
      { source: "/finance", destination: "/finance/transactions", permanent: false },
      { source: "/users", destination: "/settings/users", permanent: false },
      { source: "/expenses", destination: "/vendors/bills", permanent: false },
      { source: "/employees", destination: "/team", permanent: false },
      { source: "/documents", destination: "/vault", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
