import jwt from "jsonwebtoken";

/**
 * Signs a short opaque JWT used for the open-tracking pixel and click-tracking
 * redirect links embedded in outgoing mail. Ported from
 * `courselit/packages/common-logic` `jwtUtils.generateToken`.
 */
export function generatePixelToken(
    payload: Record<string, unknown>,
    expiresIn: string = "365d",
): string {
    const secret = process.env.PIXEL_SIGNING_SECRET;
    if (!secret) {
        throw new Error("PIXEL_SIGNING_SECRET environment variable is not defined");
    }
    return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
}

export function verifyPixelToken<T = Record<string, unknown>>(
    token: string,
): T | null {
    const secret = process.env.PIXEL_SIGNING_SECRET;
    if (!secret) {
        throw new Error("PIXEL_SIGNING_SECRET environment variable is not defined");
    }
    try {
        return jwt.verify(token, secret) as T;
    } catch {
        return null;
    }
}
