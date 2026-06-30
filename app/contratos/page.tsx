import { Suspense } from "react";
import { ContractsList } from "@/components/contracts-list";

export default function ContractsPage() {
  return (
    <Suspense fallback={null}>
      <ContractsList />
    </Suspense>
  );
}
