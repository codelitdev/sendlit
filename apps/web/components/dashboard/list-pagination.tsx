"use client";

import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";

export function ListPagination({
    page,
    total,
    itemsPerPage,
    disabled,
    onPageChange,
}: {
    page: number;
    total: number;
    itemsPerPage: number;
    disabled?: boolean;
    onPageChange: (page: number) => void;
}) {
    const pageCount = Math.ceil(total / itemsPerPage);
    if (pageCount <= 1) return null;

    function navigate(
        event: React.MouseEvent<HTMLAnchorElement>,
        next: number,
    ) {
        event.preventDefault();
        if (!disabled && next >= 1 && next <= pageCount) onPageChange(next);
    }

    return (
        <Pagination className="mt-4">
            <PaginationContent>
                <PaginationItem>
                    <PaginationPrevious
                        href="#"
                        aria-disabled={disabled || page === 1}
                        className={
                            disabled || page === 1
                                ? "pointer-events-none opacity-50"
                                : undefined
                        }
                        onClick={(event) => navigate(event, page - 1)}
                    />
                </PaginationItem>
                <PaginationItem>
                    <PaginationLink
                        href="#"
                        isActive
                        size="default"
                        onClick={(event) => event.preventDefault()}
                    >
                        {page} of {pageCount}
                    </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                    <PaginationNext
                        href="#"
                        aria-disabled={disabled || page === pageCount}
                        className={
                            disabled || page === pageCount
                                ? "pointer-events-none opacity-50"
                                : undefined
                        }
                        onClick={(event) => navigate(event, page + 1)}
                    />
                </PaginationItem>
            </PaginationContent>
        </Pagination>
    );
}
