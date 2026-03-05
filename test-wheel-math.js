// Test to understand the exact wheel math

// Simulate 3 participants: [Wasi, Mohit, John]
const participants = [
  { firstName: 'Wasi', lastName: 'Shah' },
  { firstName: 'Mohit', lastName: 'Kumar' },
  { firstName: 'John', lastName: 'Doe' }
];

const count = participants.length;
const sliceAngleRadians = (2 * Math.PI) / count; // radians per slice
const sliceAngleDegrees = 360 / count; // degrees per slice

console.log('=== WHEEL SETUP ===');
console.log(`Participants: ${count}`);
console.log(`Slice angle: ${sliceAngleDegrees}° (${sliceAngleRadians} radians)`);
console.log('');

// In canvas, when we draw:
// - ctx.arc(0, 0, radius, startAngle, endAngle) draws COUNTER-CLOCKWISE
// - 0 radians = 3 o'clock (right)
// - π/2 radians = 6 o'clock (bottom)
// - π radians = 9 o'clock (left)
// - 3π/2 radians = 12 o'clock (top)

// But we rotate the canvas first with ctx.rotate(wheelRotation)
// When wheelRotation = 0:
// - Slice 0 is drawn from 0 to sliceAngle (starting at 3 o'clock, going counter-clockwise)

console.log('=== SLICE POSITIONS (wheelRotation = 0) ===');
for (let i = 0; i < count; i++) {
  const startAngleRad = i * sliceAngleRadians;
  const endAngleRad = startAngleRad + sliceAngleRadians;
  const centerAngleRad = startAngleRad + sliceAngleRadians / 2;
  
  const startAngleDeg = (startAngleRad * 180 / Math.PI);
  const endAngleDeg = (endAngleRad * 180 / Math.PI);
  const centerAngleDeg = (centerAngleRad * 180 / Math.PI);
  
  console.log(`Slice ${i} (${participants[i].firstName}):`);
  console.log(`  Start: ${startAngleDeg.toFixed(1)}° (${startAngleRad.toFixed(3)} rad)`);
  console.log(`  End: ${endAngleDeg.toFixed(1)}° (${endAngleRad.toFixed(3)} rad)`);
  console.log(`  Center: ${centerAngleDeg.toFixed(1)}° (${centerAngleRad.toFixed(3)} rad)`);
  console.log('');
}

// The pointer is at the TOP of the canvas
// In standard canvas coordinates (0,0 at center):
// - Top = -Y direction = 270° in standard math = -90° from right = 3π/2 radians
// But in canvas, 0° is at 3 o'clock, so top is at 3π/2 or -π/2

console.log('=== POINTER POSITION ===');
console.log('Pointer is at TOP of canvas');
console.log('In canvas coordinates: -π/2 radians or 3π/2 radians');
console.log('In degrees: 270° (or -90°)');
console.log('');

// Now, when we rotate the canvas by wheelRotation degrees:
// ctx.rotate(wheelRotation * Math.PI / 180)
// This rotates the ENTIRE coordinate system clockwise (positive = clockwise)

// So if we want slice[i] to be under the pointer at top:
// We need slice[i]'s center to be at the angle where the pointer is

// Since pointer is at top = 270° in canvas coordinates
// And slice[i] center is at centerAngleDeg
// We need to rotate so that: (centerAngleDeg + wheelRotation) % 360 = 270

console.log('=== TO ELIMINATE EACH PERSON ===');
for (let i = 0; i < count; i++) {
  const centerAngleRad = (i * sliceAngleRadians) + (sliceAngleRadians / 2);
  const centerAngleDeg = (centerAngleRad * 180 / Math.PI);
  
  // Pointer is at 270° (top)
  // We want: (centerAngleDeg + wheelRotation) % 360 = 270
  // So: wheelRotation = 270 - centerAngleDeg
  // But we want positive rotation, so: wheelRotation = (270 - centerAngleDeg + 360) % 360
  
  const targetRotation = (270 - centerAngleDeg + 360) % 360;
  
  console.log(`To eliminate ${participants[i].firstName}:`);
  console.log(`  Slice center: ${centerAngleDeg.toFixed(1)}°`);
  console.log(`  Rotate wheel by: ${targetRotation.toFixed(1)}°`);
  console.log(`  Verification: (${centerAngleDeg.toFixed(1)} + ${targetRotation.toFixed(1)}) % 360 = ${((centerAngleDeg + targetRotation) % 360).toFixed(1)}°`);
  console.log('');
}

console.log('=== WAIT - CHECK CANVAS ROTATION DIRECTION ===');
console.log('ctx.rotate() with POSITIVE value rotates CLOCKWISE');
console.log('So when we do ctx.rotate(wheelRotation * PI/180):');
console.log('- Positive wheelRotation = clockwise rotation');
console.log('- This moves slices to the RIGHT (clockwise)');
console.log('');

console.log('=== CORRECTED CALCULATION ===');
console.log('If slice is at angle A, and we rotate by R degrees clockwise:');
console.log('The slice moves to position (A + R) % 360');
console.log('We want it at 270° (top where pointer is)');
console.log('So: (A + R) % 360 = 270');
console.log('Therefore: R = (270 - A + 360) % 360');
console.log('');

// But wait - in canvas, 0° is at 3 o'clock
// When we draw slice[0] from 0 to sliceAngle, it starts at 3 o'clock
// The pointer is at 12 o'clock = 270° or -90°

// Actually, let me think about this differently:
// When wheelRotation = 0, where is slice[0]?
// Slice[0] is drawn from 0 radians to sliceAngle radians
// 0 radians in canvas = 3 o'clock (right side)
// So slice[0] starts at the RIGHT side of the wheel

// The pointer is at the TOP
// In canvas, top = -π/2 radians from 0 = -90° = 270°

console.log('=== FINAL UNDERSTANDING ===');
console.log('When wheelRotation = 0:');
console.log('- Slice[0] center is at: 60° (canvas coordinates, 0° = right)');
console.log('- Pointer is at: 270° (top)');
console.log('- To get Slice[0] under pointer: rotate by (270 - 60) = 210°');
console.log('');
console.log('When wheelRotation = 0:');
console.log('- Slice[1] center is at: 180° (canvas coordinates)');
console.log('- To get Slice[1] under pointer: rotate by (270 - 180) = 90°');
console.log('');
console.log('When wheelRotation = 0:');
console.log('- Slice[2] center is at: 300° (canvas coordinates)');
console.log('- To get Slice[2] under pointer: rotate by (270 - 300 + 360) = 330°');
