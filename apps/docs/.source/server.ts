// @ts-nocheck
import * as __fd_glob_26 from "../content/docs/getting-started/overview.mdx?collection=docs"
import * as __fd_glob_25 from "../content/docs/getting-started/first-broadcast.mdx?collection=docs"
import * as __fd_glob_24 from "../content/docs/email-marketing/templates.mdx?collection=docs"
import * as __fd_glob_23 from "../content/docs/email-marketing/settings.mdx?collection=docs"
import * as __fd_glob_22 from "../content/docs/email-marketing/sequences.mdx?collection=docs"
import * as __fd_glob_21 from "../content/docs/email-marketing/contacts.mdx?collection=docs"
import * as __fd_glob_20 from "../content/docs/email-marketing/broadcasts.mdx?collection=docs"
import * as __fd_glob_19 from "../content/docs/email-blocks/trigger-picker.mdx?collection=docs"
import * as __fd_glob_18 from "../content/docs/email-blocks/template-chooser.mdx?collection=docs"
import * as __fd_glob_17 from "../content/docs/email-blocks/tag-editor.mdx?collection=docs"
import * as __fd_glob_16 from "../content/docs/email-blocks/subscriber-list.mdx?collection=docs"
import * as __fd_glob_15 from "../content/docs/email-blocks/sequence-email-list.mdx?collection=docs"
import * as __fd_glob_14 from "../content/docs/email-blocks/sequence-analytics.mdx?collection=docs"
import * as __fd_glob_13 from "../content/docs/email-blocks/overview.mdx?collection=docs"
import * as __fd_glob_12 from "../content/docs/email-blocks/getting-started.mdx?collection=docs"
import * as __fd_glob_11 from "../content/docs/email-blocks/email-preview.mdx?collection=docs"
import * as __fd_glob_10 from "../content/docs/email-blocks/email-editor.mdx?collection=docs"
import * as __fd_glob_9 from "../content/docs/email-blocks/contact-filter-builder.mdx?collection=docs"
import * as __fd_glob_8 from "../content/docs/developers/overview.mdx?collection=docs"
import * as __fd_glob_7 from "../content/docs/developers/authentication.mdx?collection=docs"
import * as __fd_glob_6 from "../content/docs/index.mdx?collection=docs"
import { default as __fd_glob_5 } from "../content/docs/email-blocks/meta.json?collection=docs"
import { default as __fd_glob_4 } from "../content/docs/getting-started/meta.json?collection=docs"
import { default as __fd_glob_3 } from "../content/docs/email-marketing/meta.json?collection=docs"
import { default as __fd_glob_2 } from "../content/docs/developers/meta.json?collection=docs"
import { default as __fd_glob_1 } from "../content/docs/api-reference/meta.json?collection=docs"
import { default as __fd_glob_0 } from "../content/docs/meta.json?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>({"doc":{"passthroughs":["extractedReferences"]}});

export const docs = await create.docs("docs", "content/docs", {"meta.json": __fd_glob_0, "api-reference/meta.json": __fd_glob_1, "developers/meta.json": __fd_glob_2, "email-marketing/meta.json": __fd_glob_3, "getting-started/meta.json": __fd_glob_4, "email-blocks/meta.json": __fd_glob_5, }, {"index.mdx": __fd_glob_6, "developers/authentication.mdx": __fd_glob_7, "developers/overview.mdx": __fd_glob_8, "email-blocks/contact-filter-builder.mdx": __fd_glob_9, "email-blocks/email-editor.mdx": __fd_glob_10, "email-blocks/email-preview.mdx": __fd_glob_11, "email-blocks/getting-started.mdx": __fd_glob_12, "email-blocks/overview.mdx": __fd_glob_13, "email-blocks/sequence-analytics.mdx": __fd_glob_14, "email-blocks/sequence-email-list.mdx": __fd_glob_15, "email-blocks/subscriber-list.mdx": __fd_glob_16, "email-blocks/tag-editor.mdx": __fd_glob_17, "email-blocks/template-chooser.mdx": __fd_glob_18, "email-blocks/trigger-picker.mdx": __fd_glob_19, "email-marketing/broadcasts.mdx": __fd_glob_20, "email-marketing/contacts.mdx": __fd_glob_21, "email-marketing/sequences.mdx": __fd_glob_22, "email-marketing/settings.mdx": __fd_glob_23, "email-marketing/templates.mdx": __fd_glob_24, "getting-started/first-broadcast.mdx": __fd_glob_25, "getting-started/overview.mdx": __fd_glob_26, });