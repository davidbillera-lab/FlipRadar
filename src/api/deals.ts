// tRPC mutation for processing deals
export const processDeals = async () => {
  // This is the buggy mutation that was returning 403 on non-scheduled paths
  console.log("Processing deals...");
};
