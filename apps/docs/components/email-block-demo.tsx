"use client";

import { useMemo, useState } from "react";
import {
    ContactFilterBuilder,
    EmailEditor,
    EmailPreview,
    SequenceAnalytics,
    SequenceEmailList,
    SubscriberList,
    TagEditor,
    TemplateChooser,
    TriggerPicker,
    defaultTemplateEmail,
    type ContactFilterWithAggregator,
    type ContactFilterDefinition,
    type ContactFilterSegment,
    type Email,
    type EmailTemplate,
    type SequenceEmail,
    type SubscriberListItem,
    type SystemTemplateSummary,
    type TriggerOption,
} from "@sendlit/email-blocks";

type DemoName =
    | "contact-filter-builder"
    | "trigger-picker"
    | "tag-editor"
    | "sequence-analytics"
    | "subscriber-list"
    | "sequence-email-list"
    | "email-editor"
    | "email-preview"
    | "template-chooser";

const day = 86_400_000;
const now = new Date().toISOString();

const sampleEmail: Email = {
    ...defaultTemplateEmail,
    meta: {
        previewText: "A concise update for your audience.",
    },
    style: {
        ...defaultTemplateEmail.style,
        colors: {
            ...defaultTemplateEmail.style.colors,
            accent: "#db2777",
        },
        structure: {
            ...defaultTemplateEmail.style.structure,
            page: {
                ...defaultTemplateEmail.style.structure.page,
                width: "600px",
                borderRadius: "0px",
            },
        },
    },
    content: [
        {
            blockType: "text",
            settings: {
                content: "JUST ANNOUNCED",
                alignment: "center",
                fontSize: "12px",
                foregroundColor: "#db2777",
                paddingBottom: "0px",
            },
        },
        {
            blockType: "text",
            settings: {
                content:
                    "# Make your next announcement premium\n\nThis layout is designed for launches, webinars, and event drops where the headline and CTA need to carry the message.",
                alignment: "left",
                fontSize: "20px",
            },
        },
        {
            blockType: "link",
            settings: {
                text: "Claim your spot",
                url: "https://sendlit.dev",
                mode: "button",
                alignment: "left",
                buttonColor: "#db2777",
                buttonTextColor: "#ffffff",
                buttonBorderRadius: "999px",
                buttonPaddingX: "18px",
                buttonPaddingY: "10px",
            },
        },
        {
            blockType: "separator",
            settings: {
                color: "#f9a8d4",
                thickness: "1px",
            },
        },
        {
            blockType: "text",
            settings: {
                content:
                    "## Why this template works\n\n- Fast visual hierarchy.\n- Clean body copy.\n- Strong CTA treatment.\n\n{{address}}\n\n[Unsubscribe]({{unsubscribe_link}})",
                alignment: "left",
                fontSize: "14px",
            },
        },
    ],
};

const initialFilter: ContactFilterWithAggregator = {
    aggregator: "and",
    filters: [
        { name: "tag", condition: "is", value: "customers" },
        { name: "email", condition: "contains", value: "@example.com" },
    ],
};

const initialContactSegments: ContactFilterSegment[] = [
    {
        id: "paid-product",
        name: "Paid product",
        filter: {
            aggregator: "and",
            filters: [
                { name: "subscription", condition: "is", value: "subscribed" },
            ],
        },
    },
    {
        id: "tagged-customers",
        name: "Tagged: customers",
        filter: {
            aggregator: "and",
            filters: [{ name: "tag", condition: "is", value: "customers" }],
        },
    },
];

const contactFilterDefinitions: ContactFilterDefinition[] = [
    {
        name: "email",
        label: "Email",
        conditions: [
            { value: "is", label: "is exactly" },
            { value: "contains", label: "contains" },
            { value: "not_contains", label: "does not contain" },
        ],
        valueInput: {
            type: "text",
            label: "Email value",
            placeholder: "e.g. example.com",
        },
    },
    {
        name: "community",
        label: "Community",
        conditions: [
            { value: "has", label: "member of" },
            { value: "does_not_have", label: "not a member of" },
        ],
        valueInput: {
            type: "select",
            label: "Community",
            placeholder: "Select community",
            options: [
                { value: "community-discussion", label: "Discussion Learners" },
                { value: "community-customers", label: "Customers" },
            ],
        },
    },
    {
        name: "lastActive",
        label: "Last active",
        conditions: [
            { value: "after", label: "after" },
            { value: "before", label: "before" },
            { value: "on", label: "on" },
        ],
        valueInput: {
            type: "date",
            label: "Last active date",
            dateValueFormat: "date",
        },
    },
    {
        name: "tag",
        label: "Tag",
        conditions: [
            { value: "has", label: "has" },
            { value: "does_not_have", label: "does not have" },
        ],
        valueInput: {
            type: "select",
            label: "Tag",
            placeholder: "Select a tag",
            options: [
                { value: "customers", label: "customers" },
                { value: "webinar", label: "webinar" },
                { value: "trial", label: "trial" },
            ],
        },
    },
    {
        name: "permission",
        label: "Permission",
        conditions: [
            { value: "has", label: "has" },
            { value: "does_not_have", label: "does not have" },
        ],
        valueInput: {
            type: "select",
            label: "Permission",
            placeholder: "Select permission",
            options: [
                { value: "manage_products", label: "Manage products" },
                { value: "publish_content", label: "Publish content" },
                { value: "buy_products", label: "Buy products" },
                { value: "manage_users", label: "Manage users" },
                { value: "manage_community", label: "Manage community" },
            ],
        },
    },
];

const initialEmails: SequenceEmail[] = [
    {
        id: "1",
        sequenceId: "seq_1",
        emailId: "email_1",
        subject: "Welcome to SendLit",
        content: sampleEmail,
        delayInMillis: 0,
        published: true,
        createdAt: now,
        updatedAt: now,
    },
    {
        id: "2",
        sequenceId: "seq_1",
        emailId: "email_2",
        subject: "Your first campaign checklist",
        content: sampleEmail,
        delayInMillis: 2 * day,
        published: false,
        actionType: "tag:add",
        actionData: { tag: "activated" },
        createdAt: now,
        updatedAt: now,
    },
    {
        id: "3",
        sequenceId: "seq_1",
        emailId: "email_3",
        subject: "How to improve deliverability",
        content: sampleEmail,
        delayInMillis: 5 * day,
        published: true,
        createdAt: now,
        updatedAt: now,
    },
];

const analyticsMetrics = [
    {
        label: "Subscribers",
        value: 11,
        helpText: "Contacts currently enrolled in this sequence.",
    },
    {
        label: "Emails Sent",
        value: 11,
        helpText: "Total emails delivered by this sequence.",
    },
    {
        label: "Open Rate",
        value: "18.2%",
        helpText: "Delivered emails that were opened.",
    },
    {
        label: "Click Rate",
        value: "0.0%",
        helpText: "Delivered emails with at least one tracked click.",
    },
    {
        label: "Click-to-Open",
        value: "0.0%",
        helpText: "Opened emails that also received a tracked click.",
    },
];

const allSubscribers: SubscriberListItem[] = [
    {
        id: "contact_1",
        name: "Ava Whitfield",
        email: "ava.whitfield@example.com",
    },
    { id: "contact_2", email: "noah.carter@example.com" },
    { id: "contact_3", email: "mia.johnson@example.com" },
    {
        id: "contact_4",
        name: "Isabelle Moreau",
        email: "isabelle.moreau@example.com",
    },
    {
        id: "contact_5",
        name: "Olivia Bennett",
        email: "olivia.bennett@example.com",
    },
    {
        id: "contact_6",
        name: "Ethan Brooks",
        email: "ethan.brooks@example.com",
    },
    { id: "contact_7", email: "sophia.reyes@example.com" },
    {
        id: "contact_8",
        name: "Lucas Fischer",
        email: "lucas.fischer@example.com",
    },
    { id: "contact_9", email: "amara.osei@example.com" },
    { id: "contact_10", name: "Grace Kim", email: "grace.kim@example.com" },
    { id: "contact_11", email: "daniel.novak@example.com" },
    {
        id: "contact_12",
        name: "Priya Sharma",
        email: "priya.sharma@example.com",
    },
    { id: "contact_13", email: "victor.alves@example.com" },
    { id: "contact_14", name: "Marco Rossi", email: "marco.rossi@example.com" },
    { id: "contact_15", email: "hannah.wells@example.com" },
    { id: "contact_16", name: "Aiko Tanaka", email: "aiko.tanaka@example.com" },
    { id: "contact_17", email: "ibrahim.khalil@example.com" },
    {
        id: "contact_18",
        name: "Liam O'Brien",
        email: "liam.obrien@example.com",
    },
    { id: "contact_19", email: "zoe.martin@example.com" },
    {
        id: "contact_20",
        name: "Sofia Torres",
        email: "sofia.torres@example.com",
    },
].map((subscriber) => ({ ...subscriber, href: `/contacts/${subscriber.id}` }));

const SUBSCRIBERS_PER_PAGE = 10;

const systemTemplates: SystemTemplateSummary[] = [
    {
        templateId: "announcement",
        title: "Announcement",
        description: "Launch a feature, webinar, or limited-time offer.",
        content: sampleEmail,
    },
    {
        templateId: "blank",
        title: "Blank",
        description: "Start from the required unsubscribe and address footer.",
        content: defaultTemplateEmail,
    },
];

const savedTemplates: EmailTemplate[] = [
    {
        id: "template_row_1",
        teamId: "team_1",
        templateId: "customer-update",
        title: "Customer update",
        content: sampleEmail,
        createdAt: now,
        updatedAt: now,
    },
];

export function EmailBlockDemo({ demo }: { demo: DemoName }) {
    const [filter, setFilter] =
        useState<ContactFilterWithAggregator>(initialFilter);
    const [contactSegments, setContactSegments] = useState<
        ContactFilterSegment[]
    >(initialContactSegments);
    const [selectedSegmentId, setSelectedSegmentId] = useState("");
    const [trigger, setTrigger] = useState<{
        triggerType: string;
        triggerData?: string | null;
    }>({
        triggerType: "tag:added",
        triggerData: "customers",
    });
    const [tagOptions, setTagOptions] = useState([
        "customers",
        "webinar",
        "trial",
        "vip",
    ]);
    const [contactTags, setContactTags] = useState(["customers"]);
    const triggers: TriggerOption[] = useMemo(
        () => [
            {
                value: "subscriber:added",
                label: "A new contact subscribes",
                needsData: false,
            },
            {
                value: "tag:added",
                label: "A tag is added to a contact",
                needsData: true,
                dataLabel: "Tag",
                valueInput: {
                    type: "select",
                    placeholder: "Select a tag",
                    options: tagOptions.map((tag) => ({
                        value: tag,
                        label: tag,
                    })),
                },
            },
            {
                value: "tag:removed",
                label: "A tag is removed from a contact",
                needsData: true,
                dataLabel: "Tag",
                valueInput: {
                    type: "select",
                    placeholder: "Select a tag",
                    options: tagOptions.map((tag) => ({
                        value: tag,
                        label: tag,
                    })),
                },
            },
        ],
        [tagOptions],
    );
    const [emails, setEmails] = useState<SequenceEmail[]>(initialEmails);
    const [selectedEmailId, setSelectedEmailId] = useState("email_1");
    const [emailsOrder, setEmailsOrder] = useState([
        "email_1",
        "email_2",
        "email_3",
    ]);
    const [editorEmail, setEditorEmail] = useState<Email>(sampleEmail);
    const [selectedTemplate, setSelectedTemplate] = useState("announcement");
    const [subscriberPage, setSubscriberPage] = useState(1);
    const subscriberTotalPages = Math.ceil(
        allSubscribers.length / SUBSCRIBERS_PER_PAGE,
    );
    const pagedSubscribers = allSubscribers.slice(
        (subscriberPage - 1) * SUBSCRIBERS_PER_PAGE,
        subscriberPage * SUBSCRIBERS_PER_PAGE,
    );

    const selectedTemplateLabel = useMemo(() => {
        const allTemplates = [...systemTemplates, ...savedTemplates];
        return allTemplates.find(
            (template) => template.templateId === selectedTemplate,
        )?.title;
    }, [selectedTemplate]);

    switch (demo) {
        case "contact-filter-builder":
            return (
                <DemoFrame
                    title="ContactFilterBuilder"
                    description="Audience filters for broadcasts."
                >
                    <ContactFilterBuilder
                        value={filter}
                        onChange={setFilter}
                        filterDefinitions={contactFilterDefinitions}
                        segments={contactSegments}
                        selectedSegmentId={selectedSegmentId}
                        onSegmentSelect={(segment) =>
                            setSelectedSegmentId(segment.id)
                        }
                        onSaveSegment={(name, savedFilter) => {
                            const newSegment: ContactFilterSegment = {
                                id: `segment-${Date.now()}`,
                                name,
                                filter: savedFilter,
                            };
                            setContactSegments((current) => [
                                ...current,
                                newSegment,
                            ]);
                            setSelectedSegmentId(newSegment.id);
                        }}
                        onDeleteSegment={(segment) => {
                            setContactSegments((current) =>
                                current.filter(
                                    (item) => item.id !== segment.id,
                                ),
                            );
                        }}
                        count={51}
                    />
                </DemoFrame>
            );
        case "trigger-picker":
            return (
                <DemoFrame
                    title="TriggerPicker"
                    description="Enrollment event for sequences."
                >
                    <TriggerPicker
                        triggerType={trigger.triggerType}
                        triggerData={trigger.triggerData}
                        triggers={triggers}
                        onChange={setTrigger}
                    />
                </DemoFrame>
            );
        case "tag-editor":
            return (
                <DemoFrame
                    title="TagEditor"
                    description="Contact tags: chips, existing-tag dropdown, and create."
                >
                    <TagEditor
                        tags={contactTags}
                        options={tagOptions}
                        onAdd={(tag) => {
                            setContactTags((current) =>
                                current.includes(tag)
                                    ? current
                                    : [...current, tag],
                            );
                            setTagOptions((current) =>
                                current.includes(tag)
                                    ? current
                                    : [...current, tag],
                            );
                        }}
                        onRemove={(tag) =>
                            setContactTags((current) =>
                                current.filter((item) => item !== tag),
                            )
                        }
                    />
                </DemoFrame>
            );
        case "sequence-analytics":
            return (
                <DemoFrame
                    title="SequenceAnalytics"
                    description="Aggregate performance metrics."
                >
                    <SequenceAnalytics metrics={analyticsMetrics} />
                </DemoFrame>
            );
        case "subscriber-list":
            return (
                <DemoFrame
                    title="SubscriberList"
                    description="Paginated subscriber list."
                >
                    <SubscriberList
                        subscribers={pagedSubscribers}
                        totalCount={allSubscribers.length}
                        page={subscriberPage}
                        totalPages={subscriberTotalPages}
                        onPageChange={setSubscriberPage}
                    />
                </DemoFrame>
            );
        case "sequence-email-list":
            return (
                <DemoFrame
                    title="SequenceEmailList"
                    description="Ordered sequence steps."
                >
                    <SequenceEmailList
                        emails={emails}
                        emailsOrder={emailsOrder}
                        selectedEmailId={selectedEmailId}
                        onSelect={setSelectedEmailId}
                        onAdd={(templateId) => {
                            const template = [
                                ...systemTemplates,
                                ...savedTemplates,
                            ].find((item) => item.templateId === templateId);
                            if (!template) return;
                            const emailId = `email_${Date.now()}`;
                            const newEmail: SequenceEmail = {
                                id: emailId,
                                sequenceId: "seq_1",
                                emailId,
                                subject: `New email from "${template.title}"`,
                                content: template.content,
                                delayInMillis: 0,
                                published: false,
                                createdAt: now,
                                updatedAt: now,
                            };
                            setEmails((current) => [...current, newEmail]);
                            setEmailsOrder((current) => [...current, emailId]);
                            setSelectedEmailId(emailId);
                        }}
                        onDelete={(emailId) => {
                            setEmails((current) =>
                                current.filter(
                                    (email) => email.emailId !== emailId,
                                ),
                            );
                            setEmailsOrder((current) =>
                                current.filter((id) => id !== emailId),
                            );
                        }}
                        onReorder={setEmailsOrder}
                        systemTemplates={systemTemplates}
                        templates={savedTemplates}
                    />
                </DemoFrame>
            );
        case "email-editor":
            return (
                <DemoFrame
                    title="EmailEditor"
                    description="WYSIWYG editor for an email's content."
                    tall
                >
                    <EmailEditor
                        email={editorEmail}
                        onChange={setEditorEmail}
                    />
                </DemoFrame>
            );
        case "email-preview":
            return (
                <DemoFrame
                    title="EmailPreview"
                    description="Rendered email iframe preview."
                >
                    <EmailPreview content={sampleEmail} minHeight="360px" />
                </DemoFrame>
            );
        case "template-chooser":
            return (
                <DemoFrame
                    title="TemplateChooser"
                    description={`Selected: ${selectedTemplateLabel ?? selectedTemplate}`}
                >
                    <TemplateChooser
                        systemTemplates={systemTemplates}
                        templates={savedTemplates}
                        onSelect={({ templateId }) =>
                            setSelectedTemplate(templateId)
                        }
                    />
                </DemoFrame>
            );
    }
}

function DemoFrame({
    title,
    description,
    children,
    tall,
}: {
    title: string;
    description: string;
    children: React.ReactNode;
    tall?: boolean;
}) {
    return (
        <div className="email-block-demo">
            <div className="email-block-demo__header">
                <h3>{title}</h3>
                <p>{description}</p>
            </div>
            <div
                className={
                    tall
                        ? "email-block-demo__body email-block-demo__tall"
                        : "email-block-demo__body"
                }
            >
                {children}
            </div>
        </div>
    );
}
