import type { Pagination } from '../../../hooks/useHubApi';

interface PaginationBarProps {
  pagination: Pagination | null;
  currentPage: number;
  onPageChange: (page: number) => void;
}

export default function PaginationBar({ pagination, currentPage, onPageChange }: PaginationBarProps) {
  if (!pagination || pagination.totalPages <= 1) return null;
  return (
    <div className="hub-pagination">
      <button
        disabled={!pagination.hasPrev}
        onClick={() => onPageChange(currentPage - 1)}
      >
        Prev
      </button>
      <span className="hub-pagination__info">
        Page {pagination.page} of {pagination.totalPages}
        <span className="hub-pagination__total">({pagination.total} total)</span>
      </span>
      <button
        disabled={!pagination.hasNext}
        onClick={() => onPageChange(currentPage + 1)}
      >
        Next
      </button>
    </div>
  );
}
