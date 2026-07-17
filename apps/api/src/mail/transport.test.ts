import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createTransport: vi.fn(),
    getDefaultCredentials: vi.fn(),
    getCredentialsById: vi.fn(),
}));

vi.mock("nodemailer", () => ({ createTransport: mocks.createTransport }));
vi.mock("../settings/esp/queries", () => ({
    getDecryptedEspCredentials: mocks.getDefaultCredentials,
    getDecryptedEspCredentialsById: mocks.getCredentialsById,
}));

const credentials = {
    host: "smtp.example.com",
    port: 587,
    secure: false,
    username: "mailer",
    password: "secret",
};

function transporter(name: string) {
    return { name, close: vi.fn(), sendMail: vi.fn() };
}

beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getCredentialsById.mockResolvedValue(credentials);
    mocks.getDefaultCredentials.mockResolvedValue(credentials);
});

describe("ESP transport cache", () => {
    it("constructs SMTP pooling and authentication from decrypted credentials", async () => {
        const smtp = transporter("smtp");
        mocks.createTransport.mockReturnValue(smtp);
        const { getEspTransport } = await import("./transport.js");

        await expect(getEspTransport("team-1", "esp-1")).resolves.toBe(smtp);

        expect(mocks.createTransport).toHaveBeenCalledWith({
            pool: true,
            maxConnections: 5,
            host: "smtp.example.com",
            port: 587,
            secure: false,
            auth: { user: "mailer", pass: "secret" },
        });
    });

    it("does not create or cache a transport when credentials are missing", async () => {
        mocks.getCredentialsById.mockResolvedValue(null);
        const { getEspTransport } = await import("./transport.js");

        await expect(getEspTransport("team-1", "esp-1")).resolves.toBeNull();
        await expect(getEspTransport("team-1", "esp-1")).resolves.toBeNull();

        expect(mocks.getCredentialsById).toHaveBeenCalledTimes(2);
        expect(mocks.createTransport).not.toHaveBeenCalled();
    });

    it("reuses a transport only for the same team and ESP", async () => {
        const first = transporter("first");
        const second = transporter("second");
        const third = transporter("third");
        mocks.createTransport
            .mockReturnValueOnce(first)
            .mockReturnValueOnce(second)
            .mockReturnValueOnce(third);
        const { getEspTransport } = await import("./transport.js");

        expect(await getEspTransport("team-1", "esp-1")).toBe(first);
        expect(await getEspTransport("team-1", "esp-1")).toBe(first);
        expect(await getEspTransport("team-1", "esp-2")).toBe(second);
        expect(await getEspTransport("team-2", "esp-1")).toBe(third);

        expect(mocks.createTransport).toHaveBeenCalledTimes(3);
    });

    it("closes and replaces an invalidated ESP transport", async () => {
        const stale = transporter("stale");
        const fresh = transporter("fresh");
        mocks.createTransport
            .mockReturnValueOnce(stale)
            .mockReturnValueOnce(fresh);
        const { getEspTransport, invalidateEspTransport } =
            await import("./transport.js");

        expect(await getEspTransport("team-1", "esp-1")).toBe(stale);
        invalidateEspTransport("team-1", "esp-1");
        expect(stale.close).toHaveBeenCalledOnce();
        expect(await getEspTransport("team-1", "esp-1")).toBe(fresh);
    });

    it("invalidates every transport for one team without touching another team", async () => {
        const teamOneA = transporter("team-one-a");
        const teamOneB = transporter("team-one-b");
        const teamTwo = transporter("team-two");
        const replacement = transporter("replacement");
        mocks.createTransport
            .mockReturnValueOnce(teamOneA)
            .mockReturnValueOnce(teamOneB)
            .mockReturnValueOnce(teamTwo)
            .mockReturnValueOnce(replacement);
        const { getEspTransport, invalidateTeamTransport } =
            await import("./transport.js");

        await getEspTransport("team-1", "esp-a");
        await getEspTransport("team-1", "esp-b");
        await getEspTransport("team-2", "esp-a");
        invalidateTeamTransport("team-1");

        expect(teamOneA.close).toHaveBeenCalledOnce();
        expect(teamOneB.close).toHaveBeenCalledOnce();
        expect(teamTwo.close).not.toHaveBeenCalled();
        expect(await getEspTransport("team-2", "esp-a")).toBe(teamTwo);
        expect(await getEspTransport("team-1", "esp-a")).toBe(replacement);
    });

    it("keeps the compatibility default transport separate from a pinned ESP", async () => {
        const pinned = transporter("pinned");
        const fallback = transporter("fallback");
        mocks.createTransport
            .mockReturnValueOnce(pinned)
            .mockReturnValueOnce(fallback);
        const { getEspTransport, getTeamTransport } =
            await import("./transport.js");

        expect(await getEspTransport("team-1", "esp-default")).toBe(pinned);
        expect(await getTeamTransport("team-1")).toBe(fallback);
        expect(await getTeamTransport("team-1")).toBe(fallback);
        expect(mocks.getDefaultCredentials).toHaveBeenCalledOnce();
    });

    it("omits SMTP auth when no username is configured", async () => {
        mocks.getCredentialsById.mockResolvedValue({
            ...credentials,
            username: null,
            password: null,
        });
        mocks.createTransport.mockReturnValue(transporter("no-auth"));
        const { getEspTransport } = await import("./transport.js");

        await getEspTransport("team-1", "esp-1");

        expect(mocks.createTransport).toHaveBeenCalledWith(
            expect.objectContaining({ auth: undefined }),
        );
    });
});
