import { z } from "zod";

/** A public signup form. `url` is its hosted page; embedded HTML forms post
 * to the same URL. */
export const signupFormSchema = z.object({
  formId: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  doubleOptIn: z.boolean(),
  redirectUrl: z.string().nullable(),
  url: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SignupForm = z.infer<typeof signupFormSchema>;

export const createSignupFormBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  tags: z
    .array(z.string().min(1))
    .max(20)
    .optional()
    .describe("Added to everyone who subscribes through the form"),
  doubleOptIn: z
    .boolean()
    .optional()
    .describe(
      "Send a confirmation email and subscribe only once it's clicked (default true)",
    ),
  redirectUrl: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//i.test(value), "Must be an http(s) URL")
    .nullable()
    .optional()
    .describe("Where to send people after they submit the hosted or embedded form"),
});

export const updateSignupFormBodySchema = createSignupFormBodySchema.partial();

export type SignupFormInput = z.infer<typeof createSignupFormBodySchema>;
