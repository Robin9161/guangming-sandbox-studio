/** Smooth illustrative deck elevation; preserve XY survey bends independently. */
export function bridgeProfile(distances: number[], ground: number[], clearance = 8, maxGrade = .10) {
  if (distances.length !== ground.length || !ground.length) throw new Error('Invalid bridge profile');
  const heights = ground.map((_, i) => {
    let weighted = 0, weights = 0;
    for (let j = Math.max(0, i - 30); j < Math.min(ground.length, i + 31); j++) {
      const weight = Math.exp(-.5 * ((distances[j] - distances[i]) / 35) ** 2);
      weighted += ground[j] * weight; weights += weight;
    }
    return Math.max(weighted / weights + clearance, ground[i] + 3);
  });
  // Least grade-bounded majorant: no buried decks and no floor-to-floor DEM steps.
  for (let i = 1; i < heights.length; i++) heights[i] = Math.max(heights[i], heights[i-1] - (distances[i]-distances[i-1]) * maxGrade);
  for (let i = heights.length - 2; i >= 0; i--) heights[i] = Math.max(heights[i], heights[i+1] - (distances[i+1]-distances[i]) * maxGrade);
  return heights;
}
