"use client";

import { Fragment } from "react";
import Link from "next/link";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useBreadcrumbItems } from "@/components/dashboard/breadcrumb-context";

export function DashboardBreadcrumb() {
    const items = useBreadcrumbItems();
    if (items.length === 0) return null;

    return (
        <Breadcrumb>
            <BreadcrumbList>
                {items.map((item, index) => {
                    const isLast = index === items.length - 1;
                    return (
                        <Fragment key={`${item.label}-${index}`}>
                            <BreadcrumbItem
                                className={
                                    isLast ? undefined : "hidden md:block"
                                }
                            >
                                {isLast || !item.href ? (
                                    <BreadcrumbPage>
                                        {item.label}
                                    </BreadcrumbPage>
                                ) : (
                                    <BreadcrumbLink asChild>
                                        <Link href={item.href}>
                                            {item.label}
                                        </Link>
                                    </BreadcrumbLink>
                                )}
                            </BreadcrumbItem>
                            {!isLast && (
                                <BreadcrumbSeparator className="hidden md:block" />
                            )}
                        </Fragment>
                    );
                })}
            </BreadcrumbList>
        </Breadcrumb>
    );
}
