import ApprovalQueue from '../components/approvals/ApprovalQueue';

export default function ApprovalsPage() {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Approvals</h1>
        <p className="page-subtitle">Review and approve actions your SELF wants to take.</p>
      </div>
      <ApprovalQueue />
    </div>
  );
}
